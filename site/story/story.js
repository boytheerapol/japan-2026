/* Japan 2026 — Story mode
 * A self-running narrated walkthrough of the trip.
 * Data: story/script.json (narration, spots) + data/trip.json (times, hotels) + story/map.json (coastline).
 * No build step, no dependencies.
 */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Pacing. Raise CHAR_RATE to go faster, lower it to go slower.
  const CHAR_RATE = 15.5;        // Thai chars per second on screen
  const CUE_PAD = 0.8;           // seconds added to every subtitle
  const MIN_CUE = 2.7;           // seconds
  const CHAPTER_CARD = 2.8;      // seconds, no subtitle
  const VOICE_PAD = 0.45;        // seconds of breath after each narrated line
  const VOICE_WAIT = 3;          // max seconds to hold the clock for a clip that is still loading
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  let SCRIPT, TRIP, MAP, ROUTES = null, VOICE = null;
  const days = {};                 // n -> trip.json day
  const cues = [];                 // { start, dur, text, scene, voice }
  const scenes = [];               // { kind, start, end, ... }
  let total = 0;

  /* ------------------------------------------------------------------ */
  /* Projection (must match scripts/build_story_map.mjs)                 */
  /* ------------------------------------------------------------------ */
  const R = Math.PI / 180;
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * R) / 2));
  const proj = (lat, lng) => [MAP.S * (lng - MAP.LNG0) * R, MAP.S * (merc(MAP.LAT0) - merc(lat))];

  /* ------------------------------------------------------------------ */
  /* Text + per-day facts                                                */
  /* ------------------------------------------------------------------ */
  const fill = (s) => s
    .replace(/\{km\}/g, () => (SCRIPT._kmTotal || 0).toLocaleString("en-US"))
    .replace(/\{d(\d+)\.(\w+)\}/g, (_, n, k) => (days[n] && days[n][k]) || "");
  const cueDur = (t) => Math.max(MIN_CUE, t.length / CHAR_RATE + CUE_PAD);
  const dayKm = (n) => { const m = String((days[n] || {}).drive || "").match(/([\d,]+)\s*กม/); return m ? +m[1].replace(/,/g, "") : 0; };
  const vehicle = (n) => (n === 11 ? "🚌" : /กม/.test((days[n] || {}).drive || "") ? "🚗" : "🚇");

  /* ------------------------------------------------------------------ */
  /* Timeline                                                            */
  /* ------------------------------------------------------------------ */
  const chapterOf = (n) => SCRIPT.chapters.find((c) => c.days.includes(n));

  function addScene(scene, lines, fixedDur) {
    scene.start = total;
    if (!lines.length) total += fixedDur;
    for (const raw of lines) {
      const text = fill(raw);
      const voice = VOICE && VOICE.cues[text];          // scripts/build_story_voice.py
      const dur = voice ? voice.dur + VOICE_PAD : cueDur(text);
      cues.push({ start: total, dur, text, scene, voice });
      total += dur;
    }
    scene.end = total;
    scene.idx = scenes.length;
    scenes.push(scene);
    return scene;
  }

  function buildTimeline() {
    const N = SCRIPT.nights;
    const ch0 = SCRIPT.chapters[0];
    SCRIPT._kmTotal = SCRIPT.days.reduce((a, d) => a + dayKm(d.n), 0);
    addScene({ kind: "title", chapter: ch0, mood: "fuji" }, SCRIPT.intro);
    addScene({ kind: "overview", chapter: ch0, mood: "fuji" }, SCRIPT.overview);
    let lastCh = null, km = 0;
    for (const d of SCRIPT.days) {
      const ch = chapterOf(d.n);
      const mood = ch.mood;
      const pts = [];
      const start = N[d.n - 1], end = N[d.n];
      pts.push({ lat: start[0], lng: start[1], name: start[2], night: true });
      for (const s of d.spots) pts.push(s);
      const splitIdx = d.split ? pts.length : -1;     // Ikebukuro drop-off
      if (d.split) pts.push({ lat: end[0], lng: end[1], name: end[2], night: true });
      for (const s of d.spotsAfter || []) pts.push(s);
      if (!d.split) pts.push({ lat: end[0], lng: end[1], name: end[2], night: true });
      const day = { n: d.n, data: d, ch, pts, splitIdx, kmBefore: km, km: dayKm(d.n), veh: vehicle(d.n) };
      km += day.km;
      d._day = day;

      if (ch !== lastCh) { addScene({ kind: "chapter", chapter: ch, mood, day }, [], CHAPTER_CARD); lastCh = ch; }
      addScene({ kind: "day", chapter: ch, mood, day, reach: 0 }, [d.open]);
      d.spots.forEach((s, i) => addScene({ kind: "spot", chapter: ch, mood, day, spot: s, reach: i + 1 }, s.lines));
      if (d.split) addScene({ kind: "split", chapter: ch, mood, day, reach: splitIdx }, d.split);
      (d.spotsAfter || []).forEach((s, i) => addScene({ kind: "spot", chapter: ch, mood, day, spot: s, reach: splitIdx + 1 + i }, s.lines));
      if (d.close) addScene({ kind: "close", chapter: ch, mood, day, reach: pts.length - 1 }, [d.close]);
    }
    addScene({ kind: "outro", chapter: ch0, mood: "fuji" }, SCRIPT.outro);
  }

  /* ------------------------------------------------------------------ */
  /* Map                                                                  */
  /* ------------------------------------------------------------------ */
  const svg = $("#map");
  const routesG = $("#routes");
  const markersEl = $("#markers");
  const cam = { x: 0, y: 0, w: 1000 };
  let camTarget = { x: 0, y: 0, w: 1000 };
  const pins = [];
  let moverEl, headEl, odoEl;

  function svgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  const pathFor = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");

  function makeMarker(cls, html) {
    const el = document.createElement("div");
    el.className = cls;
    el.innerHTML = html;
    markersEl.append(el);
    return el;
  }

  function prepMap() {
    $("#landJapan").setAttribute("d", MAP.japan);
    $("#landRegion").setAttribute("d", MAP.region);
    $("#lakes").setAttribute("d", Object.values(SCRIPT.lakes || {}).map((ring) =>
      ring.map(([la, ln], i) => { const [x, y] = proj(la, ln); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join("") + "Z").join(""));
    for (const d of SCRIPT.days) for (const p of d._day.pts) [p.x, p.y] = proj(p.lat, p.lng);

    const all = [];
    for (const d of SCRIPT.days) {
      const day = d._day;
      // over-land geometry from routes.json (one polyline per leg); straight lines if it is missing
      const legs = (ROUTES && ROUTES.days[d.n] && ROUTES.days[d.n].legs.length === day.pts.length - 1)
        ? ROUTES.days[d.n].legs.map((l) => l.map(([x, y]) => ({ x, y })))
        : day.pts.slice(1).map((p, i) => [day.pts[i], p]);
      const line = legs.flatMap((l, i) => (i ? l.slice(1) : l));
      const dstr = pathFor(line);
      day.base = svgEl("path", { class: "route base", d: dstr });
      day.casing = svgEl("path", { class: "route casing", d: dstr });
      day.live = svgEl("path", { class: "route live", d: dstr, stroke: day.ch.color });
      routesG.append(day.base, day.casing, day.live);
      let acc = 0; day.cum = [0];                     // path length at each stop
      for (const l of legs) { for (let i = 1; i < l.length; i++) acc += Math.hypot(l[i].x - l[i - 1].x, l[i].y - l[i - 1].y); day.cum.push(acc); }
      day.len = acc || 1;
      for (const el of [day.live, day.casing]) el.style.strokeDasharray = `${day.len} ${day.len}`;
      day._frac = 0;
      all.push(day);
    }
    SCRIPT._allDays = all;

    const d8 = SCRIPT.days.find((d) => d.split);
    if (d8) {
      const a = d8._day.pts[d8._day.splitIdx], n = SCRIPT.nights["0"];
      const [nx, ny] = proj(n[0], n[1]);
      d8._day.car = { a, b: { x: nx, y: ny } };
      const car = ROUTES && ROUTES.days[d8.n] && ROUTES.days[d8.n].car;
      d8._day.carPath = svgEl("path", { class: "route car", d: car ? pathFor(car.map(([x, y]) => ({ x, y }))) : `M${a.x},${a.y}L${nx},${ny}` });
      d8._day.carPath.style.opacity = 0;
      routesG.append(d8._day.carPath);
    }

    const seen = new Set();
    for (const d of SCRIPT.days) {
      for (const p of d._day.pts) {
        if (p.night && seen.has(p.name)) { p.pin = pins.find((q) => q.name === p.name); continue; }
        if (p.night) seen.add(p.name);
        const el = makeMarker("pin" + (p.night ? " night" : "") + (p.golden ? " golden" : ""), `<i></i><b>${esc(p.name)}</b>`);
        const pin = { el, x: p.x, y: p.y, name: p.name, night: !!p.night };
        pins.push(pin);
        p.pin = pin;
      }
    }
    const [fx, fy] = proj(SCRIPT.fuji[0], SCRIPT.fuji[1]);
    const fujiEl = makeMarker("fuji", `<svg viewBox="0 0 44 30" aria-hidden="true"><path d="M1 29 L16 7 Q22 2 28 7 L43 29 Z" fill="#5b7bb0"/><path d="M16 7 Q22 2 28 7 L31.5 12 L27 10 L24 13 L21 10 L18 12.5 L12.8 12 Z" fill="#fff"/></svg><span>富士山</span>`);
    pins.push({ el: fujiEl, x: fx, y: fy, fuji: true });
    moverEl = makeMarker("mover", "<span>🚗</span>");
    moverEl.style.opacity = 0;
    headEl = makeMarker("head", "<span>🚗</span>");
    headEl.style.opacity = 0;
    odoEl = $("#odo");
  }

  let _ms = { W: 1, H: 1 };
  function measure() { const r = svg.getBoundingClientRect(); _ms = { W: Math.max(1, r.width), H: Math.max(1, r.height) }; fx.resize(); }

  function bboxCam(points, pad = 1.45, minW = 70) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const { W, H } = _ms;
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: Math.max((x1 - x0) * pad, (y1 - y0) * pad * (W / H), minW) };
  }
  const regionCam = () => bboxCam(SCRIPT._allDays.flatMap((d) => d.pts), 1.2);
  function spotCam(day, spot) {   // the day's sightseeing cluster, not the long drive in/out
    const group = (day.data.spotsAfter || []).includes(spot) ? day.data.spotsAfter : day.data.spots;
    return bboxCam(group, 1.9, 110);
  }
  function japanCam() {
    const [x, y, w, h] = MAP.japanBox, { W, H } = _ms;
    return { x: x + w * 0.62, y: y + h * 0.52, w: Math.max(w * 0.55, h * 0.55 * (W / H)) };
  }

  let vx = 0, vy = 0, k = 1;
  const toScreen = (p) => `translate(${(p.x - vx) * k}px, ${(p.y - vy) * k}px)`;
  function applyCam() {
    const { W, H } = _ms;
    const h = cam.w * (H / W);
    vx = cam.x - cam.w / 2; vy = cam.y - h / 2; k = W / cam.w;
    svg.setAttribute("viewBox", `${vx} ${vy} ${cam.w} ${h}`);
    const u = 1 / k;
    svg.style.setProperty("--u", u);
    for (const d of SCRIPT._allDays) if (d.carPath) d.carPath.style.strokeDasharray = `${2 * u} ${7 * u}`;
    for (const p of pins) p.el.style.transform = toScreen(p);
    if (moverEl._pos) moverEl.style.transform = toScreen(moverEl._pos);
    if (headEl._pos) headEl.style.transform = toScreen(headEl._pos);
    $("#landJapan").style.opacity = cam.w > 1600 ? 1 : 0;
  }
  function stepCam(dt, snap) {
    if (snap || REDUCED) { Object.assign(cam, camTarget); return applyCam(); }
    const a = 1 - Math.exp(-dt * 3.2);
    cam.x += (camTarget.x - cam.x) * a;
    cam.y += (camTarget.y - cam.y) * a;
    cam.w *= Math.pow(camTarget.w / cam.w, a);
    applyCam();
  }

  function setRoute(day, frac) {
    day._frac = clamp(frac, 0, 1);
    const off = String(day.len * (1 - day._frac));
    day.live.style.strokeDashoffset = off;
    day.casing.style.strokeDashoffset = off;
  }
  function routeFracAt(day, idx, t) {
    if (idx <= 0) return 0;
    const a = day.cum[idx - 1], b = day.cum[Math.min(idx, day.cum.length - 1)];
    return (a + (b - a) * t) / day.len;
  }
  function tipOf(day) {
    const p = day.live.getPointAtLength(day.len * day._frac);
    return { x: p.x, y: p.y };
  }
  function setHead(day, show) {
    if (!show || !day) { headEl.style.opacity = 0; return; }
    headEl.firstChild.textContent = day.veh;
    headEl._pos = tipOf(day);
    headEl.style.opacity = 1;
  }
  function setOdo(day) {
    if (!day) { odoEl.hidden = true; return; }
    odoEl.hidden = false;
    if (!day.km) { odoEl.innerHTML = `<span>${day.veh}</span> Day ${day.n} · ${day.veh === "🚌" ? "Limousine bus" : "รถไฟ + เดิน"}`; return; }
    const km = Math.round(day.kmBefore + day.km * day._frac);
    odoEl.innerHTML = `<span>🚗</span> Day ${day.n} · <b>${km.toLocaleString("en-US")}</b> / ${SCRIPT._kmTotal.toLocaleString("en-US")} กม.`;
  }

  /* ------------------------------------------------------------------ */
  /* Photo side                                                           */
  /* ------------------------------------------------------------------ */
  const photoEl = $("#photo");
  const frames = [...document.querySelectorAll(".frame")];
  let frameFlip = 0, transN = 0;
  const TRANSITIONS = ["fx-zoom", "fx-slide", "fx-iris", "fx-tilt"];
  const imgCache = new Map();
  const imgUrl = (key) => `../img/${key}-${innerWidth > 900 || devicePixelRatio > 1.5 ? 1200 : 600}.webp`;

  function preload(key) {
    if (!key) return Promise.resolve(false);
    if (imgCache.has(key)) return imgCache.get(key);
    const p = new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => { imgCache.delete(key); res(false); }; im.src = imgUrl(key); });
    imgCache.set(key, p);
    return p;
  }

  let photoToken = 0;
  async function showPhoto(key, jpText, caption, sceneDur) {
    const token = ++photoToken;
    const ok = await preload(key);
    if (token !== photoToken) return;                 // a newer scene already took over
    const f = frames[frameFlip ^= 1], other = frames[frameFlip ^ 1];
    const r = () => `${(Math.random() * 6 - 3).toFixed(1)}%`;
    f.innerHTML = "";
    if (ok) {
      const d = document.createElement("div");
      d.className = "img";
      d.style.backgroundImage = `url("${imgUrl(key)}")`;
      d.style.setProperty("--kb-dur", `${Math.max(5, sceneDur + 1)}s`);
      for (const v of ["--kx0", "--ky0", "--kx1", "--ky1"]) d.style.setProperty(v, r());
      f.append(d);
    } else {
      f.insertAdjacentHTML("beforeend", `<div class="fallback"><span>${esc(jpText || "")}</span></div>`);
    }
    if (caption) f.insertAdjacentHTML("beforeend", caption);
    f.classList.remove("show", ...TRANSITIONS);
    void f.offsetWidth;                               // restart the entrance animation
    f.classList.add("show", REDUCED ? "fx-none" : TRANSITIONS[transN++ % TRANSITIONS.length]);
    f.style.zIndex = 2; other.style.zIndex = 1;
    other.classList.remove("show");
  }

  const cardLayer = $("#cardLayer");
  const setCard = (html) => { cardLayer.innerHTML = html || ""; };

  /* ------------------------------------------------------------------ */
  /* Overlay scenes                                                       */
  /* ------------------------------------------------------------------ */
  const overlay = $("#overlay");
  function setOverlay(cls, html) {
    if (!html) { overlay.classList.remove("show"); return; }
    overlay.className = `overlay show ${cls}`;
    overlay.innerHTML = html;
  }
  const letters = (s, d0 = 0.9, step = 0.06) => [...s].map((c, i) => `<span style="animation-delay:${(d0 + i * step).toFixed(2)}s">${c === " " ? "&nbsp;" : esc(c)}</span>`).join("");

  const FUJI_SVG = `<svg class="title-fuji" viewBox="0 0 360 170" aria-hidden="true">
    <path pathLength="1" d="M4 166 C60 150 100 120 138 58 Q150 38 164 34 L196 34 Q210 38 222 58 C260 120 300 150 356 166"/>
    <path class="snow" pathLength="1" d="M138 58 L150 70 L162 60 L174 74 L186 60 L198 72 L210 60 L222 58"/>
    <circle cx="290" cy="40" r="16"/></svg>`;

  /* ------------------------------------------------------------------ */
  /* Particles (maple leaves / golden sparkles) on a canvas               */
  /* ------------------------------------------------------------------ */
  const fx = (() => {
    const cv = $("#fx"), ctx = cv.getContext("2d");
    let mode = "none", parts = [], W = 1, H = 1, dpr = 1, area = null;
    const LEAF = ["#d9362b", "#ef6a50", "#f08a4b", "#e3b458", "#c2410c"];
    function resize() {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height;
      cv.width = W * dpr; cv.height = H * dpr;
    }
    function spawn() {
      if (mode === "leaves") parts.push({ t: "leaf", x: Math.random() * W, y: -20, vx: -10 + Math.random() * 20, vy: 35 + Math.random() * 45, r: 7 + Math.random() * 9, a: Math.random() * 6, va: -2 + Math.random() * 4, sw: Math.random() * 6, c: LEAF[(Math.random() * LEAF.length) | 0], life: 99 });
      if (mode === "sparkle") {
        const b = area || { x: 0, y: 0, w: W, h: H };
        parts.push({ t: "spark", x: b.x + Math.random() * b.w, y: b.y + b.h * (0.25 + Math.random() * 0.7), vx: 0, vy: -12 - Math.random() * 20, r: 2 + Math.random() * 4, life: 1.2 + Math.random() * 1.2, age: 0 });
      }
    }
    function leaf(p) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {                       // five-lobed momiji
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * p.r, Math.sin(a) * p.r);
        const b = a + Math.PI / 5;
        ctx.lineTo(Math.cos(b) * p.r * 0.42, Math.sin(b) * p.r * 0.42);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, p.r * 1.3); ctx.stroke();
      ctx.restore();
    }
    function spark(p) {
      const k = Math.sin((p.age / p.life) * Math.PI);
      ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = k; ctx.fillStyle = "#ffe2a6";
      ctx.shadowColor = "#ffb347"; ctx.shadowBlur = 12;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; ctx.lineTo(Math.cos(a) * p.r * 2.4, Math.sin(a) * p.r * 2.4); ctx.lineTo(Math.cos(a + Math.PI / 4) * p.r * 0.5, Math.sin(a + Math.PI / 4) * p.r * 0.5); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    let acc = 0;
    function step(dt) {
      if (mode === "none" && !parts.length) return;
      acc += dt;
      const rate = mode === "leaves" ? 0.28 : mode === "sparkle" ? 0.09 : Infinity;
      while (acc > rate) { acc -= rate; if (parts.length < 60) spawn(); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      parts = parts.filter((p) => {
        p.x += (p.vx + (p.t === "leaf" ? Math.sin((p.sw += dt * 1.6)) * 22 : 0)) * dt;
        p.y += p.vy * dt;
        if (p.t === "leaf") { p.a += p.va * dt; leaf(p); return p.y < H + 30; }
        p.age += dt; spark(p); return p.age < p.life;
      });
    }
    return {
      resize,
      set(m, rect) { mode = REDUCED ? "none" : m; area = rect || null; if (m !== "none") acc = 1; },
      step,
      clear() { parts = []; ctx.clearRect(0, 0, cv.width, cv.height); },
    };
  })();

  function photoRect() {   // photo panel position inside the stage (for sparkles)
    const s = $("#stage").getBoundingClientRect(), p = photoEl.getBoundingClientRect();
    return { x: p.left - s.left, y: p.top - s.top, w: p.width, h: p.height };
  }

  /* ------------------------------------------------------------------ */
  /* Scene enter / update                                                 */
  /* ------------------------------------------------------------------ */
  let curScene = null;
  const dayOrder = () => SCRIPT._allDays;

  function routesUpTo(n, fracForN) {
    for (const d of dayOrder()) {
      const f = d.n < n ? 1 : d.n === n ? fracForN : 0;
      setRoute(d, f);
      d.live.style.opacity = d.n < n ? 0.45 : 1;
      d.casing.style.opacity = d.n < n ? 0.45 : 1;
    }
  }

  function pinsFor(day, reach) {
    const active = new Set(), cur = reach != null && day ? day.pts[reach] : null;
    if (day) day.pts.forEach((p, i) => { if (i <= reach) active.add(p.pin); });
    for (const p of pins) {
      if (p.fuji) continue;
      const isActive = active.has(p);
      p.el.classList.toggle("on", isActive || p.night);
      p.el.classList.toggle("dot", !isActive && !p.night);
      p.el.classList.toggle("cur", !!cur && cur.pin === p && !p.night);
    }
  }

  function dayCard(day) {
    const t = days[day.n] || {}, d = day.data;
    const facts = [
      d.hideDepart ? "" : `<span>ออก <b>${esc(t.depart || "")}</b></span>`,
      t.drive ? `<span>${day.veh} <b>${esc(t.drive)}</b></span>` : "",
      t.sunset ? `<span>🌅 <b>${esc(t.sunset)}</b></span>` : "",
    ].join("");
    const nn = String(day.n).padStart(2, "0");
    return `<div class="card day" style="--chapter:${day.ch.color}">
      <div class="ghost" aria-hidden="true">${nn}</div>
      <div class="stamp" aria-hidden="true"><small>DAY</small>${nn}</div>
      <div class="kicker">DAY ${nn} · ${esc(day.ch.jp)}</div>
      <h2>${esc(t.title || "")}</h2>
      <div class="date">${esc(t.dateLabel || "")}</div>
      <div class="route">${esc(t.route || "")}</div>
      <div class="facts">${facts}</div>
      ${d.warn ? `<div class="warn">⚠️ ${esc(d.warn)}</div>` : ""}
    </div>`;
  }

  function spotCaption(s, day) {
    const t = days[day.n] || {};
    return `<div class="caption">
      <span class="jp">${esc(s.jp || "")}</span>
      <span class="name">${esc(s.name)}</span>
      ${s.golden ? `<span class="chip">🌅 Golden hour · ตะวันตก ${esc(t.sunset || "")}</span>` : ""}
    </div>`;
  }

  function enterScene(sc, snap) {
    const prev = curScene;
    curScene = sc;
    document.documentElement.style.setProperty("--chapter", sc.chapter.color);
    music.setMood(sc.mood);
    updateDayChips(sc);
    const dur = sc.end - sc.start, day = sc.day;
    moverEl.style.opacity = 0;
    photoEl.classList.remove("golden");
    for (const d of dayOrder()) if (d.carPath) d.carPath.style.opacity = 0;
    $(".ov-stats")?.remove();
    markersEl.style.setProperty("--night-label", sc.kind === "spot" ? "0" : "1");
    fx.set("none");
    setHead(null);
    setOdo(null);
    const live = !snap && playing;                       // only play sound effects in normal playback

    switch (sc.kind) {
      case "title": {
        setOverlay("title", `<div class="bg" style="background-image:url('../img/story/cover-1200.webp')"></div><div class="veil"></div>
          <div class="center">${FUJI_SVG}<div class="kanji">晩秋の旅</div><h1 class="letters">${letters("JAPAN 2026")}</h1>
          <div class="sub">${esc(TRIP.tagline || "")}</div>
          <div class="who"><i>🙂</i><i>😄</i><i>😎</i><i>🤗</i></div></div>`);
        camTarget = japanCam(); routesUpTo(0, 0); pinsFor(null);
        fx.set("leaves");
        break;
      }
      case "overview": {
        setOverlay("", null); setCard("");
        showPhoto("story/cover", "富士", "", dur);
        routesUpTo(0, 0); pinsFor(null);
        camTarget = japanCam();
        const box = document.createElement("div");
        box.className = "ov-stats";
        const golden = SCRIPT.days.reduce((a, d) => a + [...d.spots, ...(d.spotsAfter || [])].filter((s) => s.golden).length, 0);
        box.innerHTML = `<div><b data-to="11">0</b><span>วัน</span></div><div><b data-to="${SCRIPT._kmTotal}">0</b><span>กม. ขับเอง</span></div><div><b data-to="${SCRIPT.chapters.length}">0</b><span>ภาค</span></div><div><b data-to="${golden}">0</b><span>golden hour</span></div>`;
        $("#mapWrap").append(box);
        if (live) music.sfx("whoosh");
        break;
      }
      case "chapter": {
        setOverlay("chapter", `<div class="veil"></div>
          <div class="center" style="--chapter:${sc.chapter.color}">
          <div class="kanji-big">${esc(sc.chapter.jp)}</div>
          <h2>${esc(sc.chapter.name)}</h2>
          <div class="days">Day ${sc.chapter.days.join(" · ")}</div></div>`);
        camTarget = bboxCam(sc.chapter.days.flatMap((n) => SCRIPT.days.find((d) => d.n === n)._day.pts), 1.5);
        routesUpTo(day.n, 0); pinsFor(null);
        fx.set(sc.chapter.mood === "city" ? "sparkle" : "leaves");
        if (live) { music.sfx("whoosh"); music.sfx("taiko", 0.45); }
        break;
      }
      case "day": {
        setOverlay("", null);
        const first = day.data.spots[0];
        showPhoto(first && first.img, first && first.jp, "", dur + 2);
        setCard(dayCard(day));
        camTarget = bboxCam(day.pts, 1.5);
        routesUpTo(day.n, 0); pinsFor(day, 0);
        if (live) { music.sfx("whoosh"); music.sfx("stamp", 0.55); }
        break;
      }
      case "spot": {
        setOverlay("", null); setCard("");
        showPhoto(sc.spot.img, sc.spot.jp, spotCaption(sc.spot, day), dur);
        camTarget = spotCam(day, sc.spot);
        routesUpTo(day.n, 0);
        pinsFor(day, sc.reach);
        if (sc.spot.golden) {
          photoEl.classList.add("golden");
          fx.set("sparkle", photoRect());
          if (live) music.sfx("chime", 0.3);
        } else if (live) music.sfx("pop", 0.25);
        const nx = scenes[sc.idx + 1];
        if (nx && nx.spot) preload(nx.spot.img);
        break;
      }
      case "split": {
        setOverlay("", null);
        showPhoto("", "池袋", "", dur);
        setCard(`<div class="card split" style="--chapter:${day.ch.color}">
          <div class="kicker">บ่ายวันที่ ${day.n} · แยกกันแป๊บเดียว</div>
          <h2>ส่งของที่ Ikebukuro แล้วไปคืนรถ</h2>
          <ul><li><span>🚗</span><span>รถหนึ่งคัน → Narita คืนรถ → Limousine bus กลับ</span></li>
          <li><span>👥</span><span>อีกสามคน เช็คอิน + ชมวิว Sunshine 60</span></li>
          <li><span>🍜</span><span>ค่ำ รวมตัวกินราเมน</span></li></ul></div>`);
        camTarget = bboxCam([...day.pts, day.car.b], 1.35);
        routesUpTo(day.n, 0);
        pinsFor(day, sc.reach);
        day.carPath.style.opacity = 1;
        moverEl.style.opacity = 1;
        break;
      }
      case "close": {
        setOverlay("", null);
        const t = days[day.n] || {};
        if (t.hotel && !/กลับ/.test(t.hotel)) setCard(`<div class="card hotel" style="--chapter:${day.ch.color}"><div class="ico">🏨</div><div class="kicker">คืนนี้นอนที่</div><h2>${esc(t.hotel)}</h2></div>`);
        else setCard("");
        camTarget = bboxCam(day.pts, 1.5);
        routesUpTo(day.n, 0);
        pinsFor(day, day.pts.length - 1);
        const all = [...day.data.spots, ...(day.data.spotsAfter || [])];
        const hero = all.find((s) => s.golden) || all[all.length - 1];
        showPhoto(hero && hero.img, hero && hero.jp, "", dur);
        break;
      }
      case "outro": {
        setCard("");
        const gold = SCRIPT.days.flatMap((d) => [...d.spots, ...(d.spotsAfter || [])].filter((s) => s.golden));
        setOverlay("outro", `<div class="montage">${gold.map((s, i) => `<div style="background-image:url('${imgUrl(s.img)}');animation-delay:${(i * 0.22).toFixed(2)}s"></div>`).join("")}</div>
          <div class="veil"></div><div class="center"><div class="kanji">またね</div><h1 class="letters">${letters("JAPAN 2026", 1.4)}</h1><div class="sub">29.10 — 08.11 · เจอกันที่ DMK ✈️</div></div>`);
        camTarget = regionCam();
        routesUpTo(99, 1); pinsFor(null);
        fx.set("leaves");
        if (live) music.sfx("chime", 0.8);
        break;
      }
    }
    if (snap) stepCam(0, true);
    return prev;
  }

  function updateScene(sc, t) {
    const p = clamp((t - sc.start) / Math.max(0.001, sc.end - sc.start), 0, 1);
    const day = sc.day;
    if (sc.kind === "overview") {
      if (p > 0.15) camTarget = regionCam();
      const q = ease(clamp((p - 0.17) / 0.78, 0, 1));
      const list = dayOrder();
      const totalLen = list.reduce((a, d) => a + d.len, 0);
      let rem = q * totalLen, drawing = null;
      for (const d of list) { const f = clamp(rem / d.len, 0, 1); setRoute(d, f); if (f > 0 && f < 1) drawing = d; rem -= d.len; }
      if (drawing) setHead(drawing, true); else setHead(null);
      for (const b of document.querySelectorAll(".ov-stats b")) b.textContent = Math.round(+b.dataset.to * ease(clamp(p / 0.9, 0, 1))).toLocaleString("en-US");
      for (const pin of pins) if (pin.night) pin.el.classList.add("on");
    } else if (sc.kind === "day") {
      setRoute(day, 0); setHead(day, true); setOdo(day);
    } else if (sc.kind === "spot" || sc.kind === "close") {
      setRoute(day, routeFracAt(day, sc.reach, ease(clamp(p / 0.4, 0, 1))));
      setHead(day, p < 0.42); setOdo(day);
    } else if (sc.kind === "split") {
      setRoute(day, routeFracAt(day, sc.reach, ease(clamp(p / 0.3, 0, 1))));
      setHead(null); setOdo(day);
      const u = p < 0.5 ? ease(p * 2) : ease((1 - p) * 2);      // out to Narita and back
      const cp = day.carPath, pt = cp.getPointAtLength(cp.getTotalLength() * u);
      moverEl._pos = { x: pt.x, y: pt.y };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Playback                                                             */
  /* ------------------------------------------------------------------ */
  let t = 0, playing = false, last = 0, curCue = -1, stall = 0;
  const sub = $("#subtitle"), subSpan = $("#subtitle span");
  const playBtn = $("#play"), timeEl = $("#time"), seek = $("#seek");

  function sceneAt(time) {
    let lo = 0, hi = scenes.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (scenes[m].start <= time) lo = m; else hi = m - 1; }
    return scenes[lo];
  }
  function cueAt(time) {
    let lo = 0, hi = cues.length - 1, best = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= time) { best = m; lo = m + 1; } else hi = m - 1; }
    return best >= 0 && time < cues[best].start + cues[best].dur ? best : -1;
  }

  function render(snap) {
    const sc = sceneAt(t);
    if (sc !== curScene) enterScene(sc, snap);
    updateScene(sc, t);
    const ci = cueAt(t);
    if (ci !== curCue) {
      curCue = ci;
      if (ci < 0) sub.classList.add("off");
      else {
        sub.classList.remove("off");
        subSpan.textContent = cues[ci].text;
        subSpan.classList.remove("pop"); void subSpan.offsetWidth; subSpan.classList.add("pop");
        markTranscript(ci);
      }
    }
    seek.value = String(Math.round((t / total) * 1000));
    timeEl.textContent = `${fmt(t)} / ${fmt(total)}`;
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    if (playing) {
      if (narrator.waiting(t)) {
        stall += dt;
        if (stall >= VOICE_WAIT) narrator.skip(t);      // give up on this clip, carry on with subtitles only
      } else {
        stall = 0;
        t += dt; if (t >= total) { t = total - 0.001; setPlaying(false); }
      }
    }
    narrator.sync(t, playing);
    stepCam(dt, false);
    render(false);
    fx.step(dt);
    requestAnimationFrame(frame);
  }

  function jump(time) {
    t = clamp(time, 0, total - 0.001);
    curScene = null; curCue = -1; stall = 0;
    narrator.reset();
    fx.clear();
    render(true);
    stepCam(0, true);
  }

  function setPlaying(on) {
    if (on && t >= total - 0.01) jump(0);               // finished: Play restarts from the top
    playing = on;
    playBtn.textContent = on ? "❚❚" : "▶";
    playBtn.setAttribute("aria-label", on ? "หยุดชั่วคราว" : "เล่น");
    document.documentElement.style.setProperty("--kb-state", on ? "running" : "paused");
    music.setPlaying(on);
    if (!on) narrator.stop();
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                              */
  /* ------------------------------------------------------------------ */
  function buildControls() {
    const ticks = $("#ticks");
    const dayScenes = scenes.filter((s) => s.kind === "day");
    const outro = scenes[scenes.length - 1];
    const seg = (a, b, c) => `<i style="width:${((b - a) / total) * 100}%;background:${c}"></i>`;
    ticks.innerHTML = seg(0, dayScenes[0].start, "#9a8c7e") +
      dayScenes.map((s, i) => seg(s.start, i + 1 < dayScenes.length ? dayScenes[i + 1].start : outro.start, s.chapter.color)).join("") +
      seg(outro.start, total, "#9a8c7e");

    const nav = $("#days");
    nav.innerHTML = dayScenes.map((s) => `<button type="button" data-t="${s.start}" style="--c:${s.chapter.color}" aria-label="Day ${s.day.n}">D${s.day.n}</button>`).join("");
    nav.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const i = scenes.findIndex((s) => s.start === +b.dataset.t);
      jump(scenes[i - 1] && scenes[i - 1].kind === "chapter" ? scenes[i - 1].start : +b.dataset.t);
    });

    seek.addEventListener("input", () => jump((+seek.value / 1000) * total));
    playBtn.addEventListener("click", () => { music.unlock(); setPlaying(!playing); });
    $("#fs").addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    const musicBtn = $("#music"), vol = $("#vol");
    musicBtn.addEventListener("click", () => {
      const on = musicBtn.getAttribute("aria-pressed") !== "true";
      musicBtn.setAttribute("aria-pressed", String(on));
      music.setEnabled(on);
    });
    vol.addEventListener("input", () => music.setVolume(+vol.value / 100));
    const voiceBtn = $("#voice");
    if (!VOICE) voiceBtn.hidden = true;
    voiceBtn.setAttribute("aria-pressed", String(narrator.enabled()));
    voiceBtn.addEventListener("click", () => {
      const on = !narrator.enabled();
      voiceBtn.setAttribute("aria-pressed", String(on));
      narrator.setEnabled(on);
    });

    const list = $("#txList");
    let html = "", lastHead = "";
    cues.forEach((c, i) => {
      const s = c.scene;
      const head = s.day ? `Day ${s.day.n} · ${(days[s.day.n] || {}).dateLabel || ""}` : s.kind === "outro" ? "ปิดเรื่อง" : "เปิดเรื่อง";
      if (head !== lastHead) { html += `<li class="h" style="--c:${s.chapter.color}">${esc(head)}</li>`; lastHead = head; }
      html += `<li><button type="button" data-i="${i}">${esc(c.text)}</button></li>`;
    });
    list.innerHTML = html;
    list.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) jump(cues[+b.dataset.i].start + 0.01); });
    const drawer = $("#drawer"), txBtn = $("#tx");
    const toggleTx = (on = drawer.hidden) => { drawer.hidden = !on; txBtn.setAttribute("aria-pressed", String(on)); if (on) markTranscript(curCue, true); };
    txBtn.addEventListener("click", () => toggleTx());
    $("#txClose").addEventListener("click", () => toggleTx(false));

    addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("input") && e.key !== " ") return;
      if (!$("#gate").hidden && (e.key === " " || e.key === "Enter")) { e.preventDefault(); startFromGate(); return; }
      if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
      else if (e.key === "ArrowRight") { e.preventDefault(); const s = scenes[sceneAt(t).idx + 1]; if (s) jump(s.start); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); const cur = sceneAt(t); jump((t - cur.start > 1.5 ? cur : scenes[Math.max(0, cur.idx - 1)]).start); }
      else if (e.key === "m" || e.key === "M") musicBtn.click();
      else if ((e.key === "v" || e.key === "V") && VOICE) voiceBtn.click();
      else if (e.key === "t" || e.key === "T") toggleTx();
      else if (e.key === "f" || e.key === "F") $("#fs").click();
      else if (e.key === "Escape" && !drawer.hidden) toggleTx(false);
    });
    let vw = innerWidth, vh = innerHeight;
    addEventListener("resize", () => {
      measure();
      // Mobile URL-bar show/hide only nudges the height; don't restart the scene for that.
      const big = innerWidth !== vw || Math.abs(innerHeight - vh) > vh * 0.25;
      vw = innerWidth; vh = innerHeight;
      if (big && curScene) enterScene(curScene, true);
    });
  }

  function markTranscript(i, scroll) {
    const list = $("#txList");
    list.querySelector("button.cur")?.classList.remove("cur");
    const b = list.querySelector(`button[data-i="${i}"]`);
    if (!b) return;
    b.classList.add("cur");
    if (!$("#drawer").hidden) b.scrollIntoView({ block: scroll ? "center" : "nearest", behavior: scroll ? "auto" : "smooth" });
  }

  function updateDayChips(sc) {
    const n = sc.day ? sc.day.n : 0;
    for (const b of document.querySelectorAll("#days button")) {
      const on = b.textContent === `D${n}`;
      if (on && !b.classList.contains("cur")) b.scrollIntoView({ block: "nearest", inline: "center" });
      b.classList.toggle("cur", on);
    }
  }

  function startFromGate() {
    $("#gate").hidden = true;
    music.unlock();
    jump(t);                 // re-enter the scene so its entrance animations run now
    setPlaying(true);
  }

  /* ------------------------------------------------------------------ */
  /* Music — generative Web Audio, upbeat, one groove per chapter         */
  /* ------------------------------------------------------------------ */
  const music = (() => {
    let ctx = null, master, comp, verb, verbIn, enabled = true, vol = 0.45, playingNow = false, mood = "fuji", ducked = false;
    const buses = {};
    let timer = null, nextStep = 0, step = 0, noiseBuf = null, sfxBus = null;
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

    // Grooves. Steps are 16th notes; melody entries are [step within 4 bars, midi, length in steps].
    const D_PENT_HOOK = [[0, 78, 2], [2, 81, 2], [4, 83, 2], [6, 81, 2], [8, 78, 2], [10, 76, 2], [12, 74, 4],
      [16, 76, 2], [18, 78, 2], [20, 81, 4], [26, 76, 2], [28, 74, 4],
      [32, 71, 2], [34, 74, 2], [36, 78, 2], [38, 76, 2], [40, 74, 4], [44, 71, 2], [46, 74, 2],
      [48, 74, 2], [50, 76, 2], [52, 78, 2], [54, 81, 2], [56, 83, 4], [60, 81, 4]];
    const MOODS = {
      fuji: { bpm: 104, chords: [[62, 66, 69], [61, 64, 69], [62, 66, 71], [62, 67, 71]], bass: [38, 45, 47, 43],
        kick: [0, 8, 10], clap: [4, 12], bassSteps: [0, 3, 6, 8, 11, 14], arp: "8ths", lead: D_PENT_HOOK, leadVoice: "koto" },
      sea: { bpm: 112, chords: [[62, 66, 69], [61, 64, 69], [62, 66, 71], [62, 67, 71]], bass: [38, 45, 47, 43],
        kick: [0, 7, 10], clap: [4, 12], bassSteps: [0, 2, 7, 10, 12, 15], arp: "16ths", lead: D_PENT_HOOK.map(([s, m, l]) => [s, m + 2 > 86 ? m - 10 : m + 2, l]), leadVoice: "marimba", waves: true },
      temple: { bpm: 98, chords: [[62, 67, 69], [60, 63, 67], [58, 62, 67], [60, 63, 67]], bass: [38, 36, 34, 36],
        taiko: [0, 6, 8, 12, 14], clap: [], bassSteps: [0, 8], arp: "8ths", leadVoice: "koto",
        lead: [[0, 74, 3], [3, 75, 3], [6, 79, 2], [8, 81, 4], [12, 79, 2], [14, 75, 2], [16, 74, 4], [20, 72, 2], [22, 74, 6],
          [32, 81, 2], [34, 79, 2], [36, 75, 4], [40, 74, 2], [42, 72, 2], [44, 67, 4], [48, 69, 2], [50, 72, 2], [52, 74, 8]] },
      city: { bpm: 116, chords: [[55, 59, 62, 66], [54, 57, 61, 64], [52, 55, 59, 62], [52, 55, 57, 61]], bass: [43, 42, 40, 45],
        kick: [0, 4, 8, 12], clap: [4, 12], openHat: [2, 6, 10, 14], bassSteps: [0, 2, 4, 6, 8, 10, 12, 14], octaveBass: true,
        stabs: [0, 3, 6, 10], arp: "none", leadVoice: "bell",
        lead: [[0, 81, 1], [1, 83, 1], [2, 86, 2], [6, 83, 2], [8, 81, 2], [11, 78, 3], [16, 76, 1], [17, 78, 1], [18, 81, 2], [22, 78, 2], [24, 76, 4],
          [32, 81, 1], [33, 83, 1], [34, 86, 2], [38, 88, 2], [40, 86, 2], [43, 83, 3], [48, 81, 2], [50, 78, 2], [52, 76, 2], [54, 74, 6]] },
    };

    function makeImpulse(sec = 2.2) {
      const len = ctx.sampleRate * sec, buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      return buf;
    }

    function init() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
      master = ctx.createGain(); master.gain.value = 0;
      master.connect(comp).connect(ctx.destination);
      verb = ctx.createConvolver(); verb.buffer = makeImpulse();
      verbIn = ctx.createGain(); verbIn.gain.value = 0.35;
      verbIn.connect(verb).connect(master);
      for (const k of Object.keys(MOODS)) { const g = ctx.createGain(); g.gain.value = k === mood ? 1 : 0; g.connect(master); buses[k] = g; }
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      startWaves();
      nextStep = ctx.currentTime + 0.1;
      timer = setInterval(schedule, 60);
    }
    function applyGain() {
      if (!ctx) return;
      master.gain.setTargetAtTime(enabled && playingNow ? vol * 0.6 * (ducked ? 0.35 : 1) : 0, ctx.currentTime, ducked ? 0.12 : 0.4);
    }

    // --- instruments -------------------------------------------------
    function env(g, when, a, peak, decay) {
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(peak, when + a);
      g.gain.exponentialRampToValueAtTime(0.0001, when + a + decay);
    }
    function tone(when, freq, type, peak, decay, bus, { a = 0.004, lp = 0, send = 0, detune = 0 } = {}) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq; o.detune.value = detune;
      let node = o;
      if (lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; o.connect(f); node = f; }
      node.connect(g); g.connect(bus);
      if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s).connect(verbIn); }
      env(g, when, a, peak, decay);
      o.start(when); o.stop(when + a + decay + 0.05);
      return o;
    }
    function noise(when, bus, { type = "highpass", f = 7000, q = 0.7, peak = 0.05, decay = 0.05, send = 0 } = {}) {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      s.connect(fl).connect(g).connect(bus);
      if (send) { const sg = ctx.createGain(); sg.gain.value = send; g.connect(sg).connect(verbIn); }
      env(g, when, 0.002, peak, decay);
      s.start(when, Math.random() * 1.5); s.stop(when + decay + 0.05);
    }
    function kick(when, bus, amp = 0.5) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, when); o.frequency.exponentialRampToValueAtTime(48, when + 0.12);
      g.gain.setValueAtTime(amp, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.32);
      o.connect(g).connect(bus); o.start(when); o.stop(when + 0.35);
    }
    function clap(when, bus) {
      for (let i = 0; i < 3; i++) noise(when + i * 0.011, bus, { type: "bandpass", f: 1600, q: 1.2, peak: 0.12, decay: i === 2 ? 0.14 : 0.02, send: 0.25 });
    }
    function taiko(when, bus, amp = 0.55) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(95, when); o.frequency.exponentialRampToValueAtTime(58, when + 0.25);
      g.gain.setValueAtTime(amp, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.55);
      o.connect(g).connect(bus); o.start(when); o.stop(when + 0.6);
      noise(when, bus, { type: "lowpass", f: 900, peak: 0.18, decay: 0.08 });
    }
    const voices = {
      koto: (w, m, len, bus) => { tone(w, mtof(m), "triangle", 0.2, 0.9, bus, { lp: 3500, send: 0.3 }); tone(w, mtof(m) * 2, "sine", 0.05, 0.4, bus); },
      marimba: (w, m, len, bus) => { tone(w, mtof(m), "sine", 0.24, 0.45, bus, { send: 0.2 }); tone(w, mtof(m) * 4, "sine", 0.04, 0.08, bus); },
      bell: (w, m, len, bus) => { tone(w, mtof(m), "sine", 0.14, 0.7, bus, { send: 0.35 }); tone(w, mtof(m) * 2.01, "sine", 0.05, 0.35, bus); tone(w, mtof(m), "square", 0.02, 0.25, bus, { lp: 2400 }); },
    };
    function bass(when, midi, len, bus) {
      tone(when, mtof(midi), "triangle", 0.3, len * 0.9, bus, { lp: 700 });
      tone(when, mtof(midi), "sine", 0.22, len, bus);
    }
    function stab(when, chord, bus) {
      for (const n of chord) { tone(when, mtof(n + 12), "sine", 0.06, 0.35, bus, { send: 0.2 }); tone(when, mtof(n + 12), "triangle", 0.03, 0.2, bus, { lp: 2200, detune: 6 }); }
    }
    function pad(when, chord, len, bus) {
      for (const n of chord) tone(when, mtof(n), "sawtooth", 0.018, len, bus, { a: 0.25, lp: 1100, detune: (Math.random() - 0.5) * 14 });
    }
    function startWaves() {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 600;
      const g = ctx.createGain(); g.gain.value = 0.03;
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 0.11; lg.gain.value = 0.025;
      lfo.connect(lg).connect(g.gain);
      s.connect(f).connect(g).connect(buses.sea); s.start(); lfo.start();
    }

    // --- sequencer ---------------------------------------------------
    function schedule() {
      if (!ctx || !playingNow) { if (ctx) nextStep = Math.max(nextStep, ctx.currentTime + 0.05); return; }
      const M = MOODS[mood], s16 = 60 / M.bpm / 4, bus = buses[mood];
      while (nextStep < ctx.currentTime + 0.25) {
        const w = nextStep, st = step % 16, bar = Math.floor(step / 16), ci = bar % 4;
        const chord = M.chords[ci], root = M.bass[ci];
        const phrase = Math.floor(bar / 4) % 2;         // melody on every other 4-bar phrase
        // drums
        if (M.kick && M.kick.includes(st)) kick(w, bus, st === 0 ? 0.5 : 0.38);
        if (M.taiko && M.taiko.includes(st)) taiko(w, bus, st === 0 || st === 8 ? 0.6 : 0.35);
        if (M.clap && M.clap.includes(st)) clap(w, bus);
        noise(w, bus, { f: 8000, peak: st % 4 === 2 ? 0.05 : 0.022, decay: 0.03 });      // shaker
        if (M.openHat && M.openHat.includes(st)) noise(w, bus, { f: 7000, peak: 0.05, decay: 0.12 });
        // bass
        if (M.bassSteps.includes(st)) {
          const up = M.octaveBass ? (st % 4 === 2 ? 12 : 0) : st === 6 || st === 14 ? 7 : st === 11 ? 12 : 0;
          bass(w, root + up, s16 * 2, bus);
        }
        // harmony
        if (st === 0) pad(w, chord, s16 * 16, bus);
        if (M.stabs && M.stabs.includes(st)) stab(w, chord, bus);
        if (M.arp === "8ths" && st % 2 === 0) { const i = [0, 1, 2, 1, 2, 0, 1, 2][st / 2]; voices[M.leadVoice](w, chord[i] + 12, 1, bus); }
        if (M.arp === "16ths" && phrase === 1) { const i = [0, 1, 2, 1][st % 4]; voices.marimba(w, chord[i] + 12, 1, bus); }
        // lead hook
        if (phrase === 0 || M.arp === "none") {
          const pos = (step % 64);
          for (const [s, m, l] of M.lead) if (s === pos) voices[M.leadVoice](w, m, l, bus);
        }
        nextStep += s16; step++;
      }
    }

    // --- sound effects -----------------------------------------------
    const SFX = {
      whoosh(w) {
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noiseBuf; f.type = "bandpass"; f.Q.value = 1.4;
        f.frequency.setValueAtTime(300, w); f.frequency.exponentialRampToValueAtTime(5000, w + 0.45);
        g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(0.16, w + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, w + 0.6);
        s.connect(f).connect(g).connect(sfxBus); s.start(w); s.stop(w + 0.65);
      },
      pop(w) { const o = tone(w, 880, "sine", 0.12, 0.18, sfxBus, { send: 0.2 }); o.frequency.exponentialRampToValueAtTime(1320, w + 0.06); },
      chime(w) { [86, 90, 93, 98].forEach((m, i) => tone(w + i * 0.07, mtof(m), "sine", 0.09, 1.4, sfxBus, { send: 0.5 })); },
      stamp(w) { taiko(w, sfxBus, 0.45); noise(w, sfxBus, { type: "bandpass", f: 400, peak: 0.2, decay: 0.09 }); },
      taiko(w) { taiko(w, sfxBus, 0.6); },
    };

    return {
      unlock() { init(); ctx && ctx.resume(); applyGain(); },
      setPlaying(on) { playingNow = on; applyGain(); },
      setEnabled(on) { enabled = on; applyGain(); },
      setVolume(v) { vol = v; applyGain(); },
      duck(on) { if (on !== ducked) { ducked = on; applyGain(); } },
      context() { return ctx; },
      setMood(m) {
        if (!m || m === mood) return;
        mood = m;
        step = Math.ceil(step / 16) * 16;              // new groove starts on a downbeat
        if (!ctx) return;
        for (const k in buses) buses[k].gain.setTargetAtTime(k === m ? 1 : 0, ctx.currentTime, 0.35);
      },
      sfx(name, delay = 0) { if (ctx && enabled && playingNow && SFX[name]) SFX[name](ctx.currentTime + 0.02 + delay); },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Narrator — pre-rendered clips, one per subtitle cue                  */
  /* ------------------------------------------------------------------ */
  const narrator = (() => {
    const KEY = "story.voice", KEEP = 12, AHEAD = 4;
    let on = true, src = null, srcCue = -1, skipped = -1, out = null;
    try { on = localStorage.getItem(KEY) !== "0"; } catch {}
    const bufs = new Map();                              // url -> AudioBuffer | Promise, oldest first

    function load(url) {
      const ctx = music.context();
      if (!ctx || bufs.has(url)) return;
      const p = fetch(`../${url}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((a) => ctx.decodeAudioData(a))
        .then((b) => { if (bufs.get(url) === p) bufs.set(url, b); })
        .catch(() => { if (bufs.get(url) === p) bufs.set(url, null); });   // null = broken, don't wait on it
      bufs.set(url, p);
      while (bufs.size > KEEP) bufs.delete(bufs.keys().next().value);
    }
    function prefetch(ci) {
      for (let i = ci, n = 0; i < cues.length && n < AHEAD; i++) if (cues[i].voice) { load(cues[i].voice.src); n++; }
    }
    const active = () => on && VOICE && music.context();
    function stop() {
      if (src) { src.onended = null; try { src.stop(); } catch {} src.disconnect(); src = null; }
      srcCue = -1;
      music.duck(false);
    }
    function start(ci, offset, buf) {
      const ctx = music.context();
      if (!out) { out = ctx.createGain(); out.gain.value = 1; out.connect(ctx.destination); }
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(out);
      src.onended = () => { if (srcCue === ci) { src = null; music.duck(false); } };
      src.start(0, offset);
      music.duck(true);
    }

    return {
      enabled: () => on,
      setEnabled(v) {
        on = v;
        try { localStorage.setItem(KEY, v ? "1" : "0"); } catch {}
        if (!v) stop();
      },
      stop,
      reset() { stop(); skipped = -1; },
      // True while the clip for the cue at time t is still downloading.
      waiting(time) {
        if (!active()) return false;
        const ci = cueAt(time), c = cues[ci];
        if (!c || !c.voice || ci === skipped || ci === srcCue) return false;
        load(c.voice.src);
        const b = bufs.get(c.voice.src);
        return b instanceof Promise;
      },
      skip(time) { skipped = cueAt(time); },
      // Keep the clip that belongs to time t playing (or silent when paused / off / between cues).
      sync(time, playingNow) {
        if (!active() || !playingNow) { if (src) stop(); return; }
        const ci = cueAt(time);
        if (ci === srcCue) return;
        stop();
        if (ci < 0) return;
        prefetch(ci);
        const c = cues[ci], b = c.voice && bufs.get(c.voice.src);
        if (b instanceof Promise && ci !== skipped) return;   // still loading: waiting() holds the clock
        srcCue = ci;                                     // claim it even if silent, so we don't retry every frame
        if (!c.voice || ci === skipped) return;
        const offset = time - c.start;
        if (b instanceof AudioBuffer && offset < b.duration - 0.1) start(ci, offset, b);
      },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Boot                                                                 */
  /* ------------------------------------------------------------------ */
  async function boot() {
    try {
      const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
      [SCRIPT, TRIP, MAP] = await Promise.all([get("script.json"), get("../data/trip.json"), get("map.json")]);
      ROUTES = await get("routes.json").catch(() => null);   // optional: over-land driving lines
      VOICE = await get("voice.json").catch(() => null);     // optional: narrator clips
    } catch (err) {
      document.body.insertAdjacentHTML("beforeend", `<p style="position:fixed;inset:auto 0 50% 0;text-align:center;color:#ef6a50">โหลดข้อมูลไม่สำเร็จ (${esc(err.message)}) — ต้องเปิดผ่าน http server เช่น python3 -m http.server</p>`);
      return;
    }
    for (const d of TRIP.days) days[d.n] = d;
    buildTimeline();
    measure();
    prepMap();
    buildControls();
    $("#gate").addEventListener("click", startFromGate);
    $("#gate .gate-hint").textContent = `เปิดเสียงด้วยนะ · ราว ${Math.round(total / 60)} นาที`;
    const m = location.hash.match(/^#d(\d+)$/);
    const target = m && scenes.find((s) => s.kind === "day" && s.day.n === +m[1]);
    jump(target ? target.start : 0);
    for (const s of scenes) if (s.spot && s.idx < 6) preload(s.spot.img);
    preload("story/cover");
    requestAnimationFrame(frame);
  }
  boot();
})();
