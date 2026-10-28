/* Japan 2026 — Road trip with Shiro
 * A self-running side-scroller of the trip, narrated by the rental car.
 * Data: roadtrip/script.json (scenes + lines) + data/trip.json (times, km) + optional roadtrip/voice.json.
 * Art: roadtrip/art.js. No build step, no dependencies.
 */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const A = window.ART;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Pacing. Raise CHAR_RATE to go faster, lower it to go slower.
  const CHAR_RATE = 15;          // Thai graphemes read per second
  const CUE_PAD = 0.8;           // seconds added to every line
  const MIN_CUE = 2.8;           // seconds
  const TYPE_RATE = 30;          // graphemes typed per second in the dialog box
  const CHAPTER_CARD = 3.2;      // seconds
  const END_HOLD = 8;            // seconds the end card stays before the clock stops
  const VOICE_PAD = 0.45;        // seconds of breath after each narrated line
  const VOICE_WAIT = 3;          // max seconds to hold the clock for a clip that is still loading
  const SPEED = 240;             // world units per second while driving
  const RAMP = 1.2;              // seconds to speed up / slow down
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const win = (t, a, b, fade = 0.35) => clamp(Math.min((t - a) / fade, (b - t) / fade), 0, 1); // 0..1 inside [a, b] with soft edges
  const seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("th", { granularity: "grapheme" }) : null;
  const graphemes = (s) => (seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s));

  let SCRIPT, TRIP, VOICE = null;
  const days = {};                 // n -> trip.json day
  const cues = [];                 // { start, dur, text (plain), parts, g, scene, voice }
  const scenes = [];
  let total = 0, kmTotal = 0;

  /* ------------------------------------------------------------------ */
  /* Text                                                                */
  /* ------------------------------------------------------------------ */
  const dayKm = (n) => { const m = String((days[n] || {}).drive || "").match(/([\d,]+)\s*กม/); return m ? +m[1].replace(/,/g, "") : 0; };
  const fill = (s) => String(s)
    .replace(/\{km\}/g, () => kmTotal.toLocaleString("en-US"))
    .replace(/\{d(\d+)\.(\w+)\}/g, (_, n, k) => (days[n] && days[n][k]) || "");
  // "[[place]]" and "{{12:00}}" become highlighted runs; plain text is what the narrator says.
  function parse(raw) {
    const s = fill(raw), parts = [];
    let last = 0;
    s.replace(/\[\[(.+?)\]\]|\{\{(.+?)\}\}/g, (m, hl, tm, i) => {
      if (i > last) parts.push({ t: s.slice(last, i), c: "" });
      parts.push({ t: hl || tm, c: hl ? "hl" : "tm" });
      last = i + m.length;
      return m;
    });
    if (last < s.length) parts.push({ t: s.slice(last), c: "" });
    return { plain: parts.map((p) => p.t).join(""), parts };
  }
  const partsHTML = (parts) => parts.map((p) => (p.c ? `<span class="${p.c}">${esc(p.t)}</span>` : esc(p.t))).join("");

  /* ------------------------------------------------------------------ */
  /* Timeline                                                            */
  /* ------------------------------------------------------------------ */
  const MOVING = new Set(["drive"]);
  function buildTimeline() {
    kmTotal = TRIP.days.reduce((a, d) => a + dayKm(d.n), 0);
    let people = 4, tod = "morning";
    for (const raw of SCRIPT.scenes) {
      const s = { ...raw, ch: SCRIPT.chapters[raw.chapter], idx: scenes.length, start: total };
      s.veh = raw.veh || "car";
      s.tod = raw.kind === "sunset" ? "sunset" : raw.kind === "night" ? "night" : raw.kind === "chapter" ? tod : raw.tod || "day";
      s.fromTod = tod;
      tod = s.tod;
      s.mood = raw.mood || s.ch.mood;
      s.v = MOVING.has(raw.kind) ? raw.slow || 1 : 0;
      s.pIn = people;
      if (raw.kind === "dropoff") people = 1;
      if (raw.kind === "farewell") people = 0;
      if (s.veh !== "car") people = 0;
      s.pOut = people;
      if (raw.kind === "chapter") total += CHAPTER_CARD;
      for (const line of raw.lines || []) {
        const { plain, parts } = parse(line);
        const voice = VOICE && VOICE.cues[plain];          // scripts/build_story_voice.py
        const dur = voice ? voice.dur + VOICE_PAD : Math.max(MIN_CUE, graphemes(plain).length / CHAR_RATE + CUE_PAD);
        const g = parts.flatMap((p) => graphemes(p.t).map((ch) => [ch, p.c]));
        cues.push({ start: total, dur, text: plain, parts, g, scene: s, voice, idx: cues.length });
        total += dur;
      }
      if (!raw.lines && raw.kind !== "chapter") total += 3;
      // sunsets need room for the big clock and then the photo; stops for the photo and the stamp
      const minDur = raw.kind === "sunset" ? 7 : raw.photo && !MOVING.has(raw.kind) ? 5 : 0;
      if (total - s.start < minDur) total = s.start + minDur;
      s.linesEnd = total;
      if (raw.kind === "end") total += END_HOLD;
      s.end = total;
      s.dur = s.end - s.start;
      scenes.push(s);
    }
    // Driving distance per scene, with soft starts/stops next to standing scenes.
    let sc0 = 0;
    scenes.forEach((s, i) => {
      s.ss = !scenes[i - 1] || scenes[i - 1].v === 0;
      s.se = !scenes[i + 1] || scenes[i + 1].v === 0;
      s.r = Math.min(0.45, RAMP / Math.max(0.01, s.dur));
      s.scroll0 = sc0;
      s.dist = SPEED * s.v * s.dur * integ(1, s);
      sc0 += s.dist;
    });
    // per-day odometer ranges (car days only)
    let kmBefore = 0;
    for (let n = 1; n <= 11; n++) {
      const list = scenes.filter((s) => s.day === n && s.veh === "car");
      const d = { n, km: dayKm(n), kmBefore };
      kmBefore += d.km;
      d.s0 = list.length ? list[0].scroll0 : 0;
      d.s1 = list.length ? list[list.length - 1].scroll0 + list[list.length - 1].dist : 0;
      d.start = (scenes.find((s) => s.day === n) || {}).start || 0;
      DAYS[n] = d;
    }
    for (let n = 1; n <= 11; n++) DAYS[n].end = n < 11 ? DAYS[n + 1].start : total;
    STAMPS = scenes.filter((s) => s.stamp);
  }
  const DAYS = {};
  let STAMPS = [];
  function integ(p, s) {
    const r = s.r; let a = 0;
    a += s.ss ? Math.min(p, r) ** 2 / (2 * r) : Math.min(p, r);
    if (p > r) a += Math.max(0, Math.min(p, 1 - r) - r);
    if (p > 1 - r) { const q = p - (1 - r); a += s.se ? q - (q * q) / (2 * r) : q; }
    return a;
  }
  function velFrac(p, s) {
    if (!s.v) return 0;
    if (p < s.r && s.ss) return p / s.r;
    if (p > 1 - s.r && s.se) return (1 - p) / s.r;
    return 1;
  }
  function sceneAt(time) {
    let lo = 0, hi = scenes.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (scenes[m].start <= time) lo = m; else hi = m - 1; }
    return scenes[lo];
  }
  function lastCueBefore(time) {
    let lo = 0, hi = cues.length - 1, best = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= time) { best = m; lo = m + 1; } else hi = m - 1; }
    return best;
  }
  function cueAt(time) {
    const best = lastCueBefore(time);
    return best >= 0 && time < cues[best].start + cues[best].dur ? best : -1;
  }
  function scrollAt(time) {
    const s = sceneAt(clamp(time, 0, total));
    const p = clamp((time - s.start) / s.dur, 0, 1);
    return s.scroll0 + SPEED * s.v * s.dur * integ(p, s);
  }

  /* ------------------------------------------------------------------ */
  /* Stage: sky, parallax layers, world                                   */
  /* ------------------------------------------------------------------ */
  const stage = $("#stage"), skyEl = $("#sky"), sunEl = $("#sun"), tintEl = $("#tint"), biomesEl = $("#biomes"), worldEl = $("#world");
  let SW = 0, SH = 0, U = 1, W = 360;  // stage px, px per unit, stage width in units

  const blob = (svg) => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const biomes = {};
  let curBiome = null, ground = null;
  function makeLayer(url, f) {
    const el = document.createElement("div");
    el.className = "layer" + (f === 0 ? " fixed" : "");
    el.style.backgroundImage = `url("${url}")`;
    return { el, f };
  }
  function biome(name) {
    if (biomes[name]) return biomes[name];
    const el = document.createElement("div");
    el.className = "biome";
    const layers = A.BIOMES[name]().map((l) => makeLayer(blob(A.layerSVG(l)), l.f));
    for (const l of layers) el.append(l.el);
    biomesEl.insertBefore(el, ground.road.el);
    biomes[name] = { el, layers };
    sizeLayers(layers);
    return biomes[name];
  }
  function sizeLayers(layers) {
    const tile = A.TW * U;
    for (const l of layers) {
      if (l.f === 0) continue;
      l.tile = tile;
      l.el.style.width = `${Math.ceil(SW + tile + 2)}px`;
      l.el.style.backgroundSize = `${tile}px 100%`;
    }
  }
  function setBiome(name, snap) {
    const b = biome(name);
    if (curBiome === b) return;
    const prev = curBiome;
    curBiome = b;
    b.el.style.display = "";
    stage.classList.toggle("snap", !!snap);
    void b.el.offsetWidth;
    b.el.classList.add("on");
    if (prev) {
      prev.el.classList.remove("on");
      const el = prev.el;
      setTimeout(() => { if (!el.classList.contains("on")) el.style.display = "none"; }, snap ? 0 : 1100);
    }
  }
  function placeLayers(scroll) {
    const list = [...Object.values(biomes).filter((b) => b.el.style.display !== "none").flatMap((b) => b.layers), ground.road, ground.rail];
    for (const l of list) {
      if (l.f === 0) continue;
      const x = -((scroll * l.f * U) % l.tile);
      l.el.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
    }
  }
  function measure() {
    SW = stage.clientWidth; SH = stage.clientHeight;
    U = SH / A.H; W = SW / U;
    worldEl.style.width = `${W}px`;
    worldEl.style.transform = `scale(${U})`;
    for (const b of Object.values(biomes)) sizeLayers(b.layers);
    if (ground) sizeLayers([ground.road, ground.rail]);
    stage.classList.toggle("wide", SW > SH * 1.05);
    fx.resize();
  }

  // Time of day: sky gradient stops, tint over the scenery, sun, stars.
  const TOD = {
    dawn:    { sky: ["#2f3a66", "#c97a86", "#f2b98c"], tint: [60, 50, 110, 0.24], sun: [0.8, 0.5, "#ffcf8a", 0.9], stars: 0.35 },
    morning: { sky: ["#a9cbe0", "#e3eadf", "#f3e2c0"], tint: [255, 220, 180, 0.04], sun: [0.8, 0.16, "#fff2c4", 0.8], stars: 0 },
    day:     { sky: ["#8fbfd8", "#d4e6e6", "#f1e3c4"], tint: [0, 0, 0, 0], sun: [0.84, 0.1, "#fff6d6", 0.75], stars: 0 },
    golden:  { sky: ["#9fb6d0", "#f3d39a", "#f2b56b"], tint: [240, 150, 60, 0.12], sun: [0.8, 0.3, "#ffd27a", 1], stars: 0 },
    sunset:  { sky: ["#3c3a6b", "#b8546a", "#f08a4b"], tint: [120, 50, 70, 0.26], sun: [0.8, 0.5, "#ffd27a", 1], stars: 0.15 },
    dusk:    { sky: ["#34345f", "#8a5f86", "#e0a184"], tint: [50, 40, 90, 0.32], sun: [0.8, 0.62, "#ffb36b", 0], stars: 0.45 },
    night:   { sky: ["#0b1324", "#1d2b4a", "#33406a"], tint: [10, 16, 40, 0.5], sun: [0.8, 0.7, "#ffd27a", 0], stars: 1 },
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixC = (a, b, k) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(" ")})`; };
  const mixN = (a, b, k) => a + (b - a) * k;
  let skyKey = "";
  function paintSky(sc, time) {
    let from = TOD[sc.fromTod] || TOD.day, to = TOD[sc.tod] || TOD.day;
    const span = sc.kind === "sunset" ? 2.4 : 1.6;
    let k = ease(clamp((time - sc.start) / span, 0, 1));
    if (sc.kind === "sunset" && sc.fromTod === "sunset") from = TOD.golden;
    const key = `${sc.idx}:${k.toFixed(3)}:${biomeName(sc)}`;
    let sunY = mixN(from.sun[1], to.sun[1], k);
    if (sc.kind === "sunset") sunY = mixN(0.36, 0.56, clamp((time - sc.start) / sc.dur, 0, 1));
    sunEl.style.top = `${(sunY * 100).toFixed(2)}%`;      // the sunset sun keeps sinking after the colours settle
    if (key === skyKey) return;
    skyKey = key;
    const st = from.sky.map((c, i) => mixC(c, to.sky[i], k));
    skyEl.style.background = `linear-gradient(${st[0]} 0%, ${st[1]} 52%, ${st[2]} 74%)`;
    const ti = from.tint.map((v, i) => mixN(v, to.tint[i], k));
    const nightReady = biomeName(sc) === "tokyoNight" ? 0.45 : 1;
    tintEl.style.background = `rgb(${ti.slice(0, 3).map(Math.round).join(" ")} / ${(ti[3] * nightReady).toFixed(3)})`;
    skyEl.style.setProperty("--stars", mixN(from.stars, to.stars, k).toFixed(3));
    sunEl.style.background = mixC(from.sun[2], to.sun[2], k);
    sunEl.style.opacity = mixN(from.sun[3], to.sun[3], k).toFixed(3);
    sunEl.style.left = `${(mixN(from.sun[0], to.sun[0], k) * 100).toFixed(2)}%`;
    stage.dataset.tod = k > 0.5 ? sc.tod : sc.fromTod;
  }
  const biomeName = (sc) => sc.biome || "airport";

  /* ---------- world entities (unit coordinates, y = road contact) ---------- */
  const ent = (html, cls = "") => { const el = document.createElement("div"); el.className = `ent ${cls}`; el.innerHTML = html; worldEl.append(el); return el; };
  const PLANE = `<svg viewBox="-50 -30 100 60" width="100" height="60" style="margin:-30px 0 0 -50px"><g fill="#fbf7ee" stroke="#1B1B1B" stroke-width="1.4"><path d="M-40 0 Q-40 -6 -30 -6 L34 -6 Q46 -4 48 0 Q46 4 34 4 L-30 4 Q-40 4 -40 0Z"/><path d="M0 -4 L-14 -26 L-6 -26 L14 -4Z"/><path d="M0 2 L-12 20 L-5 20 L12 2Z"/></g><path d="M-36 -4 L-44 -18 L-38 -18 L-28 -6Z" fill="#C8442F"/></svg>`;
  let propEl, propName = "", walkEl, walkN = -1, carEl, trainEl, busEl, planeEl, wheels = [];
  function makeWorld() {
    propEl = ent("", "prop");
    walkEl = ent("", "walk");
    carEl = ent(A.shiro(4), "vcar");
    busEl = ent(A.bus(), "vbus");
    trainEl = ent(A.train(), "vtrain");
    planeEl = ent(PLANE, "plane");
    wheels = [...carEl.querySelectorAll(".wheel"), ...busEl.querySelectorAll(".wheel")];
  }
  const place = (el, x, y, s = 1, rot = 0) => { el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${s})${rot ? ` rotate(${rot}deg)` : ""}`; };
  const PROP_AT = { shiro: [0.66, 526, 0.7, 1.0], default: [0.68, 522, 1, 0.9] };   // anchor x (of W), y, scale, parallax

  function updateWorld(sc, time, scroll) {
    const p = clamp((time - sc.start) / sc.dur, 0, 1);
    const vf = velFrac(p, sc) * sc.v;
    const lit = ["sunset", "dusk", "night", "dawn"].includes(stage.dataset.tod);
    // vehicles
    const veh = sc.kind === "chapter" ? (scenes[sc.idx + 1] || sc).veh : sc.veh;
    const show = (el, on) => el.classList.toggle("off", !on);
    show(carEl, veh === "car"); show(busEl, veh === "bus"); show(trainEl, veh === "train");
    const bounce = REDUCED ? 0 : Math.sin(time * 17) * 1.4 * vf + (carEl.classList.contains("honk") ? -6 : 0);
    const cx = Math.max(24, W * 0.27);
    if (veh === "car") place(carEl, cx, 556 + bounce);
    if (veh === "bus") place(busEl, Math.max(10, W * 0.06), 556 + bounce * 0.6, 0.8);
    if (veh === "train") place(trainEl, Math.min(W * 0.66, W - 40) - 410, A.RY + (REDUCED ? 0 : Math.sin(time * 9) * 0.6 * vf));
    for (const el of [carEl, busEl, trainEl]) {
      el.classList.toggle("lit", lit && vf > 0.05);
      el.classList.toggle("moving", vf > 0.25);
      el.classList.toggle("wave", sc.v === 0 && (sc.kind === "stop" || sc.wave || sc.kind === "sunset"));
    }
    carEl.classList.toggle("hazard", sc.kind === "farewell");
    const rot = (scroll / 10.5) * (180 / Math.PI);
    for (const w of wheels) w.style.transform = `rotate(${rot.toFixed(1)}deg)`;
    // people inside Shiro: the three passengers leave at the drop-off, the driver at the farewell
    let ppl = sc.pIn;
    if (sc.kind === "dropoff" && p > 0.12) ppl = sc.pOut;
    if (sc.kind === "farewell" && p > 0.08) ppl = 0;
    if (sc.kind === "chapter") ppl = sc.pOut;
    for (let i = 0; i < 4; i++) carEl.querySelector(`.p${i}`).style.display = (i === 3 ? ppl >= 1 : ppl >= 4) ? "" : "none";

    // walkers (drop-off / farewell)
    const n = sc.walkers || 0;
    if (n !== walkN) { walkN = n; walkEl.innerHTML = n ? A.walkers(n) : ""; }
    if (n) {
      const q = clamp((p - 0.1) / 0.85, 0, 1);
      const x0 = cx + (n === 1 ? 110 : 60);
      place(walkEl, x0 + q * (W * (n === 1 ? 0.32 : 0.7)), 560);
      walkEl.classList.toggle("walking", q > 0 && q < 1);
      walkEl.classList.toggle("wave", q >= 1 || (n === 1 && q > 0.7));
    }

    // landmark prop: belongs to a nearby scene, slides with the scenery and parks beside a stop
    let shown = false;
    for (const s of [scenes[sc.idx - 1], sc, scenes[sc.idx + 1]]) {
      if (!s || !s.prop) continue;
      // slides in while driving up to it; standing neighbours get a fade instead
      const prev = scenes[s.idx - 1], next = scenes[s.idx + 1];
      const a = s.start - (prev && prev.v ? 4 : 0.5), b = s.end + (next && next.v ? 4 : 0.5);
      if (time < a || time > b) continue;
      const [ax, y, sc0, fac] = PROP_AT[s.prop] || PROP_AT.default;
      const anchorT = s.kind === "drive" ? s.start + s.dur * 0.7 : s.start;
      const x = Math.max(W * ax, s.prop === "shiro" ? 0 : cx + 170) + (scrollAt(anchorT) - scroll) * fac;
      if (x < -320 || x > W + 320) continue;
      if (propName !== s.prop) { propName = s.prop; propEl.innerHTML = A.PROPS[s.prop](); }
      place(propEl, x, y, sc0);
      propEl.style.opacity = win(time, a, b, 0.5).toFixed(3);
      shown = true;
      break;
    }
    propEl.classList.toggle("off", !shown);

    // plane: takes off over the airport at the start and the end
    const pl = sc.kind === "intro" ? clamp((time - sc.start) / 7, 0, 1) : sc.kind === "end" ? clamp((time - sc.start) / 9, 0, 1) : -1;
    planeEl.classList.toggle("off", pl < 0 || pl >= 1);
    if (pl >= 0) place(planeEl, -80 + pl * (W + 200), 360 - pl * 260, 1.3 + pl * 0.4, -10);
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                  */
  /* ------------------------------------------------------------------ */
  const signEl = $("#sign"), odoEl = $("#odo"), kinEl = $("#kin"), polEl = $("#pol"), stampEl = $("#stampfx"), chapEl = $("#chap"), endEl = $("#end");
  const dlgEl = $("#dlg"), txtEl = $("#dlg .txt"), whoEl = $("#dlg .who"), avaEl = $("#dlg .ava"), pillEl = $("#daypill"), progEl = $("#prog");
  const vis = (el, on) => { if (el.hidden === on) el.hidden = !on; };
  const once = new Set();           // one-shot sound effects: "<scene>:<name>"
  let live = false;                 // true while playing forward (not seeking)

  function enterScene(sc) {
    setBiome(biomeName(sc.kind === "chapter" ? scenes[sc.idx + 1] || sc : sc), !live);
    music.setMood(sc.mood);
    // sign
    if (sc.sign) {
      const g = sc.sign;
      signEl.className = `sign${g.station ? " station" : ""}`;
      signEl.innerHTML = `${g.tag ? `<span class="tag">${esc(g.tag)}</span>` : ""}<div><span class="k">${esc(g.k)}</span><span class="d">${esc(g.d)}${g.station ? "" : "<small>km</small>"}</span><span class="r">${esc(g.r)}</span></div>`;
    }
    // photo
    if (sc.photo) {
      const img = polEl.querySelector("img");
      img.src = `../img/${sc.photo}-600.webp`;
      polEl.querySelector("span").textContent = sc.cap || "";
      polEl.style.setProperty("--rot", `${((sc.idx * 37) % 9) - 4}deg`);
    }
    if (sc.stamp) {
      const st = stampEl.querySelector(".stamp");
      st.textContent = sc.stamp;
      st.style.setProperty("--c", sc.ch.color);
    }
    if (sc.kind === "chapter") {
      $(".kanji", chapEl).textContent = sc.ch.jp;
      $(".seal", chapEl).textContent = sc.ch.seal;
      $(".name", chapEl).textContent = sc.ch.name;
      $(".sub", chapEl).textContent = sc.ch.sub;
      chapEl.style.setProperty("--c", sc.ch.color);
    }
    kinEl.classList.toggle("below", sc.kind === "intro");
    if (sc.kind === "intro") { kinEl.querySelector("b").textContent = fill(sc.kinetic.big); kinEl.querySelector("span").textContent = fill(sc.kinetic.small); }
    if (sc.kind === "sunset") { kinEl.querySelector("b").textContent = (days[sc.day] || {}).sunset || ""; kinEl.querySelector("span").textContent = `พระอาทิตย์ตก · Day ${sc.day}`; }
    whoEl.textContent = sc.radio ? "ชิโระ (วิทยุ)" : "ชิโระ";
    avaEl.innerHTML = A.avatar(!!sc.radio);
    dlgEl.classList.toggle("radio", !!sc.radio);
    const d = days[sc.day] || {};
    pillEl.innerHTML = `<b>Day ${sc.day}</b> ${esc(d.dateLabel || "")}`;
    pillEl.style.setProperty("--c", sc.ch.color);
    if (sc.kind === "end") buildEnd();
    // warm up the next photos
    for (let i = sc.idx + 1; i < Math.min(scenes.length, sc.idx + 4); i++) if (scenes[i].photo) new Image().src = `../img/${scenes[i].photo}-600.webp`;
    updateBookCount();
  }

  function sfxOnce(sc, name, at, time, delay = 0) {
    const key = `${sc.idx}:${name}`;
    if (time >= at && !once.has(key)) { once.add(key); if (live && time - at < 0.4) music.sfx(name, delay); }
  }

  function updateHUD(sc, time) {
    const rel = time - sc.start, p = clamp(rel / sc.dur, 0, 1);
    const isStand = sc.v === 0 && sc.kind !== "chapter";
    // sign + odometer on drives
    const signOn = !!sc.sign && rel > 0.25 && time < sc.end - 0.2;
    vis(signEl, signOn);
    if (sc.kind === "drive" && sc.sign && rel < 1) sfxOnce(sc, "whoosh", sc.start + 0.25, time);
    const dd = DAYS[sc.day];
    const odoOn = sc.veh === "car" && sc.kind === "drive" && dd && dd.km;
    vis(odoEl, !!odoOn);
    if (odoOn) {
      const s = scrollAt(time), frac = dd.s1 > dd.s0 ? clamp((s - dd.s0) / (dd.s1 - dd.s0), 0, 1) : 0;
      const km = Math.round(dd.kmBefore + dd.km * frac);
      const html = String(km).padStart(4, "0").split("").map((c) => `<b>${c}</b>`).join("") + "<span>km</span>";
      if (odoEl._v !== km) { odoEl._v = km; odoEl.innerHTML = html; }
    }
    // kinetic headline: intro numbers, sunset time
    const kinOn = (sc.kind === "intro" && rel > 0.4 && rel < 4.2) || (sc.kind === "sunset" && rel > 0.3 && rel < 3.2);
    vis(kinEl, kinOn);
    if (kinOn && sc.kind === "sunset") sfxOnce(sc, "chime", sc.start + 0.3, time);
    // polaroid
    const polFrom = sc.kind === "sunset" ? 3.0 : 0.6;
    const polOn = !!sc.photo && isStand && rel > polFrom && time < sc.end - 0.3;
    if (polOn !== !polEl.hidden) { vis(polEl, polOn); if (polOn) { polEl.classList.remove("in"); void polEl.offsetWidth; polEl.classList.add("in"); } }
    if (sc.photo && isStand) sfxOnce(sc, "shutter", sc.start + polFrom, time);
    // stamp
    const stFrom = sc.photo ? polFrom + 1.1 : 1.0;
    const stOn = !!sc.stamp && rel > stFrom && rel < stFrom + 2.2;
    if (stOn !== !stampEl.hidden) { vis(stampEl, stOn); if (stOn) { stampEl.classList.remove("in"); void stampEl.offsetWidth; stampEl.classList.add("in"); } }
    if (sc.stamp) { sfxOnce(sc, "stamp", sc.start + stFrom, time); if (rel > stFrom && once.has(`${sc.idx}:stamp`)) updateBookCount(); }
    // farewell: lock beep on the last line, horn at the drop-off
    if (sc.kind === "farewell") { const c = cues.filter((c) => c.scene === sc).pop(); if (c) sfxOnce(sc, "beep", c.start + 2.2, time); }
    if (sc.kind === "dropoff") sfxOnce(sc, "door", sc.start + 0.3, time);
    if (sc.kind === "intro") sfxOnce(sc, "plane", sc.start + 0.2, time);
    if (sc.veh === "train" && scenes[sc.idx - 1] && scenes[sc.idx - 1].veh !== "train") sfxOnce(sc, "jingle", sc.start + 0.2, time);
    // chapter card
    const chapOn = sc.kind === "chapter";
    vis(chapEl, chapOn);
    if (chapOn) {
      // shoji slide shut, open onto the card, then the card fades back to the road
      const shut = ease(clamp(p / 0.12, 0, 1)), open = ease(clamp((p - 0.16) / 0.16, 0, 1)), outK = ease(clamp((p - 0.86) / 0.14, 0, 1));
      chapEl.style.setProperty("--door", `${(-100 + 100 * shut - 84 * open).toFixed(2)}%`);
      chapEl.classList.toggle("shut", open < 0.5);
      chapEl.style.opacity = (1 - outK).toFixed(3);
      chapEl.classList.toggle("sealed", p > 0.38);
      sfxOnce(sc, "taiko", sc.start + sc.dur * 0.1, time);
      sfxOnce(sc, "stamp", sc.start + sc.dur * 0.38, time);
    }
    // end card
    const endOn = sc.kind === "end" && time >= sc.linesEnd - 0.6;
    vis(endEl, endOn);
    stage.classList.toggle("ending", endOn);
    // progress + pill
    for (let n = 1; n <= 11; n++) {
      const d = DAYS[n], f = clamp((time - d.start) / Math.max(0.01, d.end - d.start), 0, 1);
      const el = progEl.children[n - 1];
      if (el._f !== f) { el._f = f; el.style.setProperty("--f", f.toFixed(4)); }
    }
    progEl.setAttribute("aria-valuenow", String(sc.day));
  }

  // Dialog box: typewriter driven by the clock, so seeking always shows the right text.
  let shownCue = -1, shownN = -1;
  const forced = new Set();
  function updateDialog(time) {
    let ci = cueAt(time);
    if (ci < 0) { const b = lastCueBefore(time); if (b >= 0 && cues[b].scene === sceneAt(time)) ci = b; }   // hold the last line while a scene lingers
    dlgEl.classList.toggle("off", ci < 0);
    if (ci < 0) { shownCue = -1; return; }
    const c = cues[ci];
    const n = REDUCED || forced.has(ci) ? c.g.length : Math.min(c.g.length, Math.floor((time - c.start) * TYPE_RATE) + 1);
    if (ci === shownCue && n === shownN) return;
    if (ci !== shownCue) markTranscript(ci);
    shownCue = ci; shownN = n;
    let html = "", run = "", cls = null;
    const flush = () => { if (run) html += cls ? `<span class="${cls}">${esc(run)}</span>` : esc(run); run = ""; };
    c.g.forEach(([ch, k], i) => {
      const cc = (k || "") + (i >= n ? " rest" : "");
      if (cc.trim() !== (cls || "").trim()) { flush(); cls = cc.trim() || null; }
      run += ch;
    });
    flush();
    txtEl.innerHTML = html;
    dlgEl.classList.toggle("done", n >= c.g.length);
  }

  /* ------------------------------------------------------------------ */
  /* Leaves                                                               */
  /* ------------------------------------------------------------------ */
  const fx = (() => {
    const cv = $("#fx"), ctx = cv.getContext("2d"), leaf = new Path2D(A.LEAF), COLORS = ["#E07B39", "#C8442F", "#E9B44C"];
    let list = [], dpr = 1, w = 0, h = 0;
    const spawn = (x, y, burst) => ({ x, y, vx: burst ? (Math.random() - 0.5) * 160 : -10 - Math.random() * 20, vy: burst ? -60 - Math.random() * 120 : 30 + Math.random() * 30,
      a: Math.random() * 6, va: (Math.random() - 0.5) * 3, s: 0.7 + Math.random() * 0.8, c: COLORS[(Math.random() * 3) | 0], ph: Math.random() * 6, life: 1 });
    return {
      resize() { dpr = Math.min(2, devicePixelRatio || 1); w = stage.clientWidth; h = stage.clientHeight; cv.width = w * dpr; cv.height = h * dpr; },
      burst(x, y, n = 14) { if (!REDUCED) for (let i = 0; i < n; i++) list.push(spawn(x, y, true)); },
      clear() { list = []; },
      step(dt, ambient, wind) {
        if (REDUCED) return;
        if (list.length < ambient && Math.random() < dt * ambient * 0.5) list.push(spawn(Math.random() * (w + 80), -20, false));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const k = Math.max(1, h / 740);
        list = list.filter((l) => {
          l.ph += dt * 2; l.vy = Math.min(l.vy + 120 * dt, 60); l.vx += (Math.sin(l.ph) * 30 - l.vx * 0.5) * dt;
          l.x += (l.vx - wind) * dt; l.y += l.vy * dt; l.a += l.va * dt;
          if (l.y > h + 30 || l.x < -60 || l.x > w + 80) return false;
          ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.a); ctx.scale(l.s * k, l.s * k); ctx.fillStyle = l.c; ctx.fill(leaf); ctx.restore();
          return true;
        });
      },
    };
  })();
  const ambientFor = (sc) => (sc.kind === "farewell" ? 26 : sc.kind === "chapter" ? 10 : sc.biome === "tokyoNight" || sc.biome === "tokyo" ? 2 : 6);

  /* ------------------------------------------------------------------ */
  /* Playback                                                             */
  /* ------------------------------------------------------------------ */
  let t = 0, playing = false, last = 0, stall = 0, curScene = null;
  const playBtn = $("#play");
  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

  function render() {
    const sc = sceneAt(t);
    if (sc !== curScene) { curScene = sc; enterScene(sc); }
    const scroll = scrollAt(t);
    placeLayers(REDUCED ? sc.scroll0 : scroll);
    paintSky(sc, t);
    updateWorld(sc, t, REDUCED ? sc.scroll0 : scroll);
    updateHUD(sc, t);
    updateDialog(t);
    const veh = sc.kind === "chapter" ? (scenes[sc.idx + 1] || sc).veh : sc.veh;
    ground.rail.el.classList.toggle("on", veh === "train");     // rail deck under the train
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    live = playing;
    if (playing) {
      if (narrator.waiting(t)) {
        stall += dt;
        if (stall >= VOICE_WAIT) narrator.skip(t);
      } else {
        stall = 0;
        t += dt;
        if (t >= total) { t = total - 0.001; setPlaying(false); }
      }
    }
    narrator.sync(t, playing);
    render();
    const sc = curScene;
    fx.step(dt, ambientFor(sc), playing ? velFrac(clamp((t - sc.start) / sc.dur, 0, 1), sc) * sc.v * SPEED * U * 0.5 : 0);
    requestAnimationFrame(frame);
  }

  function jump(time) {
    t = clamp(time, 0, total - 0.001);
    live = false;
    stall = 0;
    // sounds and stamps before the new time count as already happened
    once.clear();
    for (const s of scenes) if (s.end <= t) for (const k of ["stamp", "shutter", "chime", "taiko", "whoosh", "beep", "door", "plane", "jingle"]) once.add(`${s.idx}:${k}`);
    const cur = sceneAt(t);
    for (const k of ["stamp", "shutter", "chime", "taiko", "whoosh", "beep", "door", "plane", "jingle"]) once.add(`${cur.idx}:${k}`);
    forced.clear();
    curScene = null; shownCue = -1;
    narrator.reset();
    fx.clear();
    render();
    updateBookCount();
  }

  function setPlaying(on) {
    if (on && t >= total - 0.01) jump(0);
    playing = on;
    playBtn.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute("aria-label", on ? "หยุดชั่วคราว" : "เล่น");
    stage.classList.toggle("paused", !on);
    music.setPlaying(on);
    if (!on) narrator.stop();
    poke();
  }

  /* ------------------------------------------------------------------ */
  /* Stamp book, end card, transcript                                     */
  /* ------------------------------------------------------------------ */
  const collected = () => STAMPS.filter((s) => t >= s.start + (s.photo ? (s.kind === "sunset" ? 4.1 : 1.7) : 1.0)).length;
  let lastCount = -1;
  function updateBookCount() {
    const n = collected();
    if (n === lastCount) return;
    lastCount = n;
    $("#bookCount").textContent = n ? String(n) : "";
    if (!$("#bookSheet").hidden) fillBook();
  }
  const stampHTML = (s, on, i = 0) => `<div class="stamp${on ? "" : " empty"}" style="--c:${s.ch.color};--r:${((s.idx * 37) % 24) - 12}deg;--i:${i}">${on ? esc(s.stamp) : "?"}</div>`;
  function fillBook() {
    const n = collected();
    $("#bookTitle").textContent = `สมุดแสตมป์ · ${n}/${STAMPS.length}`;
    $("#bookGrid").innerHTML = STAMPS.map((s, i) => `<figure>${stampHTML(s, i < n)}<figcaption>${i < n ? `Day ${s.day}` : ""}</figcaption></figure>`).join("");
  }
  function buildEnd() {
    $("h3", endEl).textContent = `สมุดแสตมป์ · ${STAMPS.length}/${STAMPS.length}`;
    $(".stamps", endEl).innerHTML = STAMPS.map((s, i) => stampHTML(s, true, i)).join("");
    const start = new Date(`${TRIP.start}T00:00:00+07:00`), end = new Date(`${TRIP.end}T23:59:59+07:00`), now = new Date();
    const left = Math.ceil((start - now) / 864e5);
    const [y, m, d] = TRIP.start.split("-");
    $(".count", endEl).innerHTML = now > end ? `<div class="big"><span>ขอบคุณที่ไปด้วยกัน</span></div>`
      : left > 0 ? `<div class="big"><span>อีก</span><b>${left}</b><span>วัน</span></div><span>ออกเดินทาง ${d}.${m}.${y} · DMK → NRT</span>`
      : `<div class="big"><span>เที่ยวให้สนุกนะ!</span></div><span>ชิโระรออยู่ที่ Narita</span>`;
  }

  function buildTranscript() {
    let html = "", lastDay = 0;
    cues.forEach((c, i) => {
      const s = c.scene;
      if (s.day !== lastDay) { const d = days[s.day] || {}; html += `<li class="h" style="--c:${s.ch.color}">Day ${s.day} · ${esc(d.dateLabel || "")}</li>`; lastDay = s.day; }
      html += `<li><button type="button" data-i="${i}">${partsHTML(c.parts)}</button></li>`;
    });
    $("#txList").innerHTML = html;
    $("#txList").addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) jump(cues[+b.dataset.i].start + 0.01); });
  }
  function markTranscript(i, scroll) {
    const list = $("#txList");
    list.querySelector("button.cur")?.classList.remove("cur");
    const b = list.querySelector(`button[data-i="${i}"]`);
    if (!b) return;
    b.classList.add("cur");
    if (!$("#txSheet").hidden) b.scrollIntoView({ block: scroll ? "center" : "nearest", behavior: scroll ? "auto" : "smooth" });
  }

  /* ------------------------------------------------------------------ */
  /* Controls & taps                                                      */
  /* ------------------------------------------------------------------ */
  const ctrlEl = $("#ctrl");
  let hideTimer = 0;
  function poke() {
    stage.classList.remove("hidectl");
    clearTimeout(hideTimer);
    if (playing) hideTimer = setTimeout(() => { if (playing && $("#txSheet").hidden && $("#bookSheet").hidden) stage.classList.add("hidectl"); }, 3000);
  }
  function openSheet(id, on) {
    const el = $(id);
    const show = on === undefined ? el.hidden : on;
    for (const s of document.querySelectorAll(".sheet")) s.hidden = true;
    el.hidden = !show;
    $("#tx").setAttribute("aria-pressed", String(id === "#txSheet" && show));
    $("#bookBtn").setAttribute("aria-pressed", String(id === "#bookSheet" && show));
    if (show && id === "#txSheet") markTranscript(cueAt(t), true);
    if (show && id === "#bookSheet") fillBook();
    poke();
  }

  function dayAtX(clientX) {
    const r = progEl.getBoundingClientRect();
    const x = clamp((clientX - r.left) / r.width, 0, 0.9999) * 11;
    const n = Math.floor(x) + 1, f = x - Math.floor(x), d = DAYS[n];
    return d.start + f * (d.end - d.start);
  }

  function buildControls() {
    progEl.innerHTML = Array.from({ length: 11 }, (_, i) => `<i style="--c:${(scenes.find((s) => s.day === i + 1) || scenes[0]).ch.color}"><em>${i + 1}</em></i>`).join("");
    let dragging = false;
    progEl.addEventListener("pointerdown", (e) => { dragging = true; progEl.setPointerCapture(e.pointerId); jump(dayAtX(e.clientX)); poke(); });
    progEl.addEventListener("pointermove", (e) => { if (dragging) jump(dayAtX(e.clientX)); });
    progEl.addEventListener("pointerup", () => { dragging = false; });
    progEl.addEventListener("keydown", (e) => {
      const n = sceneAt(t).day;
      if (e.key === "ArrowRight" && n < 11) { e.preventDefault(); e.stopPropagation(); jump(DAYS[n + 1].start); }
      if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); jump(DAYS[Math.max(1, n - (t - DAYS[n].start > 2 ? 0 : 1))].start); }
    });

    playBtn.addEventListener("click", () => { music.unlock(); setPlaying(!playing); });
    $("#fs").addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    const musicBtn = $("#music");
    musicBtn.addEventListener("click", () => {
      const on = musicBtn.getAttribute("aria-pressed") !== "true";
      musicBtn.setAttribute("aria-pressed", String(on));
      music.setEnabled(on);
      poke();
    });
    const voiceBtn = $("#voice");
    voiceBtn.hidden = !VOICE;
    voiceBtn.setAttribute("aria-pressed", String(narrator.enabled()));
    voiceBtn.addEventListener("click", () => { const on = !narrator.enabled(); voiceBtn.setAttribute("aria-pressed", String(on)); narrator.setEnabled(on); poke(); });
    $("#tx").addEventListener("click", () => openSheet("#txSheet"));
    $("#bookBtn").addEventListener("click", () => openSheet("#bookSheet"));
    for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", () => openSheet(`#${b.closest(".sheet").id}`, false));
    $("#replay").addEventListener("click", () => { jump(0); setPlaying(true); });
    $("#share").addEventListener("click", async () => {
      const url = location.href.split("#")[0];
      try {
        if (navigator.share) await navigator.share({ title: "Road trip กับชิโระ", text: "ทริปญี่ปุ่น 11 วัน เล่าโดยรถเช่าคันเล็กสีขาว", url });
        else { await navigator.clipboard.writeText(url); $("#share").lastChild.textContent = "คัดลอกลิงก์แล้ว"; }
      } catch {}
    });

    // taps on the scene: Shiro honks, the sky drops leaves, the dialog skips ahead
    stage.addEventListener("pointerup", (e) => {
      if (e.target.closest(".ctrl, .prog, .sheet, .gate, .end, .pol")) { poke(); return; }
      if (e.target.closest(".dlg")) {
        const ci = cueAt(t);
        if (ci >= 0) {
          const c = cues[ci], typed = Math.floor((t - c.start) * TYPE_RATE) + 1 >= c.g.length;
          if (!typed && !forced.has(ci)) forced.add(ci);
          else if (cues[ci + 1]) jump(cues[ci + 1].start + 0.01);
          shownN = -1;
        } else { const s = scenes[sceneAt(t).idx + 1]; if (s) jump(s.start); }
        poke();
        return;
      }
      const veh = [carEl, busEl, trainEl].find((el) => !el.classList.contains("off"));
      const r = veh && veh.querySelector("svg").getBoundingClientRect();
      if (r && e.clientX > r.left + r.width * 0.12 && e.clientX < r.right - r.width * 0.1 && e.clientY > r.top && e.clientY < r.bottom) {
        music.unlock();
        music.sfx("horn", 0, true);
        veh.classList.remove("honk"); void veh.offsetWidth; veh.classList.add("honk");
        setTimeout(() => veh.classList.remove("honk"), 450);
      } else {
        const sr = stage.getBoundingClientRect();
        fx.burst(e.clientX - sr.left, e.clientY - sr.top);
      }
      poke();
    });
    stage.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") poke(); });

    addEventListener("keydown", (e) => {
      if (!$("#gate").hidden && (e.key === " " || e.key === "Enter")) { e.preventDefault(); startFromGate(); return; }
      if (e.target.closest && e.target.closest("button, a") && (e.key === " " || e.key === "Enter")) return;
      poke();
      if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
      else if (e.key === "ArrowRight") { e.preventDefault(); const s = scenes[sceneAt(t).idx + 1]; if (s) jump(s.start); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); const cur = sceneAt(t); jump((t - cur.start > 1.5 ? cur : scenes[Math.max(0, cur.idx - 1)]).start); }
      else if (e.key === "m" || e.key === "M") musicBtn.click();
      else if ((e.key === "v" || e.key === "V") && VOICE) voiceBtn.click();
      else if (e.key === "t" || e.key === "T") openSheet("#txSheet");
      else if (e.key === "b" || e.key === "B") openSheet("#bookSheet");
      else if (e.key === "f" || e.key === "F") $("#fs").click();
      else if (e.key === "Escape") for (const s of document.querySelectorAll(".sheet")) if (!s.hidden) openSheet(`#${s.id}`, false);
    });
    addEventListener("resize", () => { measure(); skyKey = ""; render(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && playing) setPlaying(false); });
  }

  function startFromGate() {
    $("#gate").hidden = true;
    music.unlock();
    jump(t);
    setPlaying(true);
  }

  /* ------------------------------------------------------------------ */
  /* Music — generative Web Audio: lo-fi city pop + koto, one groove per chapter */
  /* ------------------------------------------------------------------ */
  const music = (() => {
    let ctx = null, master, comp, verb, verbIn, enabled = true, vol = 0.5, playingNow = false, mood = "fuji", ducked = false;
    const buses = {};
    let timer = null, nextStep = 0, step = 0, noiseBuf = null, sfxBus = null;
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

    // Steps are 16th notes; melody entries are [step within 4 bars, midi, length in steps]. Nothing under 96 BPM.
    const HOOK = [[0, 78, 2], [2, 81, 2], [4, 83, 2], [6, 81, 2], [8, 78, 2], [10, 76, 2], [12, 74, 4],
      [16, 76, 2], [18, 78, 2], [20, 81, 4], [26, 76, 2], [28, 74, 4],
      [32, 71, 2], [34, 74, 2], [36, 78, 2], [38, 76, 2], [40, 74, 4], [44, 71, 2], [46, 74, 2],
      [48, 74, 2], [50, 76, 2], [52, 78, 2], [54, 81, 2], [56, 83, 4], [60, 81, 4]];
    const MOODS = {
      fuji: { bpm: 108, chords: [[62, 66, 69, 73], [59, 62, 66, 69], [64, 67, 71, 74], [57, 61, 64, 67]], bass: [38, 35, 40, 33],
        kick: [0, 7, 8], clap: [4, 12], hats: true, bassSteps: [0, 3, 6, 8, 10, 14], stabs: [3, 6, 11, 14], lead: HOOK, leadVoice: "koto" },
      sea: { bpm: 100, chords: [[55, 59, 62, 66], [57, 60, 64, 67], [59, 62, 66, 69], [52, 55, 59, 62]], bass: [43, 45, 47, 40],
        kick: [0, 7, 10], clap: [4, 12], hats: true, bassSteps: [0, 2, 7, 10, 12, 15], arp: "16ths",
        lead: HOOK.map(([s, m, l]) => [s, m - 3 < 67 ? m + 9 : m - 3, l]), leadVoice: "marimba", waves: true },
      temple: { bpm: 96, chords: [[62, 65, 69, 72], [58, 62, 65, 69], [60, 64, 67, 70], [57, 60, 64, 67]], bass: [38, 34, 36, 33],
        kick: [0, 8, 10], clap: [4, 12], taiko: [14], hats: true, bassSteps: [0, 6, 8, 14], arp: "8ths", leadVoice: "koto",
        lead: [[0, 74, 3], [3, 76, 3], [6, 81, 2], [8, 79, 4], [12, 77, 2], [14, 76, 2], [16, 74, 4], [20, 72, 2], [22, 74, 6],
          [32, 81, 2], [34, 79, 2], [36, 77, 4], [40, 76, 2], [42, 74, 2], [44, 69, 4], [48, 72, 2], [50, 74, 2], [52, 76, 8]] },
      city: { bpm: 116, chords: [[55, 59, 62, 66], [54, 57, 61, 64], [52, 55, 59, 62], [52, 55, 57, 61]], bass: [43, 42, 40, 45],
        kick: [0, 4, 8, 12], clap: [4, 12], openHat: [2, 6, 10, 14], hats: true, bassSteps: [0, 2, 4, 6, 8, 10, 12, 14], octaveBass: true,
        stabs: [0, 3, 6, 10], leadVoice: "bell", leadAlways: true,
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
      sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(comp);
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
      return { s, fl, g };
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
    function stab(when, chord, bus) {   // electric-piano-ish chord hit
      for (const n of chord) { tone(when, mtof(n + 12), "sine", 0.05, 0.32, bus, { send: 0.2 }); tone(when, mtof(n + 12), "triangle", 0.025, 0.18, bus, { lp: 2200, detune: 6 }); }
    }
    function pad(when, chord, len, bus) {
      for (const n of chord) tone(when, mtof(n), "sawtooth", 0.014, len, bus, { a: 0.25, lp: 1100, detune: (Math.random() - 0.5) * 14 });
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
    function schedule() {
      if (!ctx || !playingNow) { if (ctx) nextStep = Math.max(nextStep, ctx.currentTime + 0.05); return; }
      const M = MOODS[mood], s16 = 60 / M.bpm / 4, bus = buses[mood];
      while (nextStep < ctx.currentTime + 0.25) {
        const w = nextStep, st = step % 16, bar = Math.floor(step / 16), ci = bar % 4;
        const chord = M.chords[ci], root = M.bass[ci];
        const phrase = Math.floor(bar / 4) % 2;
        if (M.kick && M.kick.includes(st)) kick(w, bus, st === 0 ? 0.5 : 0.38);
        if (M.taiko && M.taiko.includes(st)) taiko(w, bus, 0.4);
        if (M.clap && M.clap.includes(st)) clap(w, bus);
        if (M.hats) noise(w, bus, { f: 8000, peak: st % 4 === 2 ? 0.05 : 0.022, decay: 0.03 });
        if (M.openHat && M.openHat.includes(st)) noise(w, bus, { f: 7000, peak: 0.05, decay: 0.12 });
        if (M.bassSteps.includes(st)) {
          const up = M.octaveBass ? (st % 4 === 2 ? 12 : 0) : st === 6 || st === 14 ? 7 : st === 10 ? 12 : 0;
          bass(w, root + up, s16 * 2, bus);
        }
        if (st === 0) pad(w, chord, s16 * 16, bus);
        if (M.stabs && M.stabs.includes(st)) stab(w, chord, bus);
        if (M.arp === "8ths" && st % 2 === 0) { const i = [0, 1, 2, 3, 2, 1, 2, 3][st / 2]; voices[M.leadVoice](w, chord[i] + 12, 1, bus); }
        if (M.arp === "16ths" && phrase === 1) { const i = [0, 1, 2, 3][st % 4]; voices.marimba(w, chord[i] + 12, 1, bus); }
        if (phrase === 0 || M.leadAlways) {
          const pos = step % 64;
          for (const [s, m, l] of M.lead) if (s === pos) voices[M.leadVoice](w, m, l, bus);
        }
        nextStep += s16; step++;
      }
    }
    const SFX = {
      whoosh(w) {
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noiseBuf; f.type = "bandpass"; f.Q.value = 1.4;
        f.frequency.setValueAtTime(300, w); f.frequency.exponentialRampToValueAtTime(5000, w + 0.45);
        g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(0.12, w + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, w + 0.6);
        s.connect(f).connect(g).connect(sfxBus); s.start(w); s.stop(w + 0.65);
      },
      plane(w) {
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noiseBuf; s.loop = true; f.type = "lowpass"; f.Q.value = 2;
        f.frequency.setValueAtTime(250, w); f.frequency.exponentialRampToValueAtTime(1400, w + 2.2); f.frequency.exponentialRampToValueAtTime(300, w + 4.5);
        g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(0.16, w + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, w + 4.6);
        s.connect(f).connect(g).connect(sfxBus); s.start(w); s.stop(w + 4.7);
      },
      horn(w) {   // "poon poon": two short honks
        for (const d of [0, 0.2]) for (const f of [392, 494]) { const o = tone(w + d, f, "square", 0.07, 0.16, sfxBus, { a: 0.01, lp: 1600 }); o.frequency.setValueAtTime(f, w + d); }
      },
      beep(w) { for (const d of [0, 0.22]) tone(w + d, 1760, "square", 0.04, 0.09, sfxBus, { lp: 3000 }); noise(w + 0.5, sfxBus, { type: "bandpass", f: 900, peak: 0.12, decay: 0.05 }); },
      door(w) { noise(w, sfxBus, { type: "lowpass", f: 500, peak: 0.25, decay: 0.12 }); taiko(w, sfxBus, 0.2); },
      shutter(w) { noise(w, sfxBus, { type: "bandpass", f: 3200, q: 2, peak: 0.18, decay: 0.025 }); noise(w + 0.07, sfxBus, { type: "bandpass", f: 2400, q: 2, peak: 0.14, decay: 0.035 }); },
      jingle(w) { [[76, 0], [80, 0.16], [83, 0.32], [88, 0.48], [87, 0.72], [83, 0.88]].forEach(([m, d]) => tone(w + d, mtof(m), "sine", 0.09, 0.5, sfxBus, { send: 0.4 })); },
      pop(w) { const o = tone(w, 880, "sine", 0.12, 0.18, sfxBus, { send: 0.2 }); o.frequency.exponentialRampToValueAtTime(1320, w + 0.06); },
      chime(w) { [86, 90, 93, 98].forEach((m, i) => tone(w + i * 0.07, mtof(m), "sine", 0.08, 1.4, sfxBus, { send: 0.5 })); },
      stamp(w) { taiko(w, sfxBus, 0.42); noise(w, sfxBus, { type: "bandpass", f: 400, peak: 0.2, decay: 0.09 }); },
      taiko(w) { taiko(w, sfxBus, 0.6); },
    };
    return {
      unlock() { init(); ctx && ctx.resume(); applyGain(); },
      setPlaying(on) { playingNow = on; applyGain(); },
      setEnabled(on) { enabled = on; applyGain(); },
      duck(on) { if (on !== ducked) { ducked = on; applyGain(); } },
      context() { return ctx; },
      setMood(m) {
        if (!m || m === mood) return;
        mood = m;
        step = Math.ceil(step / 16) * 16;
        if (!ctx) return;
        for (const k in buses) buses[k].gain.setTargetAtTime(k === m ? 1 : 0, ctx.currentTime, 0.35);
      },
      // force: play even while paused (taps on Shiro)
      sfx(name, delay = 0, force = false) { if (ctx && enabled && (playingNow || force) && SFX[name]) SFX[name](ctx.currentTime + 0.02 + delay); },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Narrator — pre-rendered clips, one per line (roadtrip/voice.json)     */
  /* ------------------------------------------------------------------ */
  const narrator = (() => {
    const KEY = "roadtrip.voice", KEEP = 12, AHEAD = 4;
    let on = true, src = null, srcCue = -1, skipped = -1, out = null;
    try { on = localStorage.getItem(KEY) !== "0"; } catch {}
    const bufs = new Map();
    function load(url) {
      const ctx = music.context();
      if (!ctx || bufs.has(url)) return;
      const p = fetch(`../${url}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((a) => ctx.decodeAudioData(a))
        .then((b) => { if (bufs.get(url) === p) bufs.set(url, b); })
        .catch(() => { if (bufs.get(url) === p) bufs.set(url, null); });
      bufs.set(url, p);
      while (bufs.size > KEEP) bufs.delete(bufs.keys().next().value);
    }
    function prefetch(ci) { for (let i = ci, n = 0; i < cues.length && n < AHEAD; i++) if (cues[i].voice) { load(cues[i].voice.src); n++; } }
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
      setEnabled(v) { on = v; try { localStorage.setItem(KEY, v ? "1" : "0"); } catch {} if (!v) stop(); },
      stop,
      reset() { stop(); skipped = -1; },
      waiting(time) {
        if (!active()) return false;
        const ci = cueAt(time), c = cues[ci];
        if (!c || !c.voice || ci === skipped || ci === srcCue) return false;
        load(c.voice.src);
        return bufs.get(c.voice.src) instanceof Promise;
      },
      skip(time) { skipped = cueAt(time); },
      sync(time, playingNow) {
        if (!active() || !playingNow) { if (src) stop(); return; }
        const ci = cueAt(time);
        if (ci === srcCue) return;
        stop();
        if (ci < 0) return;
        prefetch(ci);
        const c = cues[ci], b = c.voice && bufs.get(c.voice.src);
        if (b instanceof Promise && ci !== skipped) return;
        srcCue = ci;
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
      [SCRIPT, TRIP] = await Promise.all([get("script.json"), get("../data/trip.json")]);
      VOICE = await get("voice.json").catch(() => null);
    } catch (err) {
      document.body.insertAdjacentHTML("beforeend", `<p style="position:fixed;inset:auto 0 50% 0;text-align:center;color:#C8442F">โหลดข้อมูลไม่สำเร็จ (${esc(err.message)}) — ต้องเปิดผ่าน http server เช่น python3 -m http.server</p>`);
      return;
    }
    for (const d of TRIP.days) days[d.n] = d;
    buildTimeline();
    ground = { road: makeLayer(blob(A.road()), 1), rail: makeLayer(blob(A.rail()), 1) };
    ground.road.el.classList.add("ground"); ground.rail.el.classList.add("ground", "railg");
    biomesEl.append(ground.road.el, ground.rail.el);
    makeWorld();
    measure();
    new ResizeObserver(() => stage.style.setProperty("--dlgH", `${dlgEl.offsetHeight}px`)).observe(dlgEl);
    buildControls();
    buildTranscript();
    $("#gateArt").innerHTML = A.poster();
    $("#gateMeta").textContent = `11 วัน · ${kmTotal.toLocaleString("en-US")} กม. · ราว ${Math.round(total / 30) / 2} นาที`;
    $("#gate").addEventListener("click", startFromGate);
    const m = location.hash.match(/^#d(\d+)$/);
    jump(m && DAYS[+m[1]] ? DAYS[+m[1]].start : 0);
    setPlaying(false);
    requestAnimationFrame(frame);
    window.roadtrip = { jump, scenes, cues, get t() { return t; }, get total() { return total; } };   // for testing from the console
  }
  boot();
})();
