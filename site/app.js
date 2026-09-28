/* Japan 2026 trip site — vanilla JS, hash routing, no build step. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const main = $("#main");
  const store = {
    get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  let trip = null;
  let lotsById = new Map();
  let countdownTimer = null;
  let deferredInstall = null;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https:\/\//i.test(u || "") ? u : "");
  const stars = (n) => (n ? `<span class="stars" aria-label="${n} ดาว">${"★".repeat(n)}</span>` : "");
  const pad = (n) => String(n).padStart(2, "0");

  function telLinks(text) {
    // "กระเช้า 0555-75-2929" -> link on the number, dialled as +81
    return esc(text).replace(/(\+81[\s-]?)?(0\d{1,4}-\d{1,4}-\d{3,4})/g, (m, cc, num) => {
      const digits = num.replace(/-/g, "").replace(/^0/, "");
      return `<a href="tel:+81${digits}">${m}</a>`;
    });
  }
  const firstPhone = (text) => {
    const m = String(text || "").match(/0\d{1,4}-\d{1,4}-\d{3,4}/);
    return m ? `tel:+81${m[0].replace(/-/g, "").replace(/^0/, "")}` : "";
  };

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function kind(item) {
    const t = item.type || "";
    if (t.includes("GOLDEN")) return "golden";
    if (t.startsWith("📸") || t.startsWith("🥾")) return "view";
    if (t.startsWith("🍜") || t.startsWith("☕")) return "food";
    if (t.startsWith("🏨")) return "hotel";
    if (t.startsWith("♨️")) return "onsen";
    if (t.startsWith("🛍") || t.startsWith("🎁")) return "shop";
    if (t.startsWith("✈️") || t.startsWith("🚌")) return "flight";
    if (t.startsWith("🤝")) return "meet";
    if (t.startsWith("🔁")) return "backup";
    if (t.startsWith("❌")) return "cut";
    return "move";
  }
  const isMoveRow = (item) => /^(🚗 ขับรถ|🚇)/.test(item.type || "") && !item.stars;

  function splitTime(t) {
    if (!t) return ["", ""];
    const [a, b] = t.split(/[–-]/);
    return [a.trim(), (b || "").trim()];
  }

  /* ---------- parking ↔ item matching ---------- */
  const STOP = new Set(["parking", "park", "lake", "hotel", "area", "observation", "deck", "free", "the", "shop", "narita", "airport"]);
  const tokens = (s) => new Set(String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/).filter((w) => w.length >= 4 && !STOP.has(w)));

  function matchParking(day) {
    const lots = day.parking.map((id) => lotsById.get(id)).filter(Boolean);
    const byItem = new Map();
    const unmatched = [];
    for (const lot of lots) {
      const lt = tokens(lot.place);
      let best = null, bestScore = 0;
      day.items.forEach((item, i) => {
        if (isMoveRow(item)) return;
        const it = tokens(item.name);
        let score = 0;
        lt.forEach((w) => { if (it.has(w)) score++; });
        if (score > bestScore) { best = i; bestScore = score; }
      });
      if (best === null) unmatched.push(lot);
      else byItem.set(best, [...(byItem.get(best) || []), lot]);
    }
    return { byItem, unmatched, lots };
  }

  /* ---------- modes ---------- */
  function applyDriver(on) {
    document.body.classList.toggle("driver", on);
    const b = $("#modeToggle");
    b.setAttribute("aria-pressed", String(on));
    $(".mode-label", b).textContent = on ? "คนขับ: เปิด" : "โหมดคนขับ";
  }
  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  /* ---------- rendering: home ---------- */
  function heroArt() {
    return `
    <svg class="hero-art" viewBox="0 70 400 460" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <defs>
        <linearGradient id="gFuji" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style="stop-color:var(--fuji-1)"/><stop offset="1" style="stop-color:var(--fuji-2)"/>
        </linearGradient>
        <linearGradient id="gLake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style="stop-color:var(--fuji-2);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--washi);stop-opacity:1"/>
        </linearGradient>
      </defs>
      <circle class="sun" cx="292" cy="150" r="44" style="fill:var(--shu)" opacity=".92"/>
      <ellipse class="mist" cx="120" cy="190" rx="120" ry="10" style="fill:var(--paper)" opacity=".55"/>
      <path d="M-20 410 C 40 360 90 350 140 372 S 250 340 300 360 S 390 350 430 372 L430 430 L-20 430Z" style="fill:var(--fuji-1)" opacity=".35"/>
      <g class="fuji">
        <path d="M30 420 L165 212 Q200 188 235 212 L372 420Z" fill="url(#gFuji)"/>
        <path d="M165 212 Q200 188 235 212 L251 236 L237 231 L225 248 L211 233 L199 252 L187 233 L173 244 L150 235Z" style="fill:var(--snow)"/>
      </g>
      <ellipse class="mist m2" cx="270" cy="330" rx="150" ry="12" style="fill:var(--paper)" opacity=".5"/>
      <rect x="-10" y="418" width="420" height="110" fill="url(#gLake)"/>
      <path d="M30 420 L165 490 Q200 500 235 490 L372 420Z" fill="url(#gFuji)" opacity=".18"/>
      <g style="fill:var(--shu)" transform="translate(40 352)">
        <rect x="0" y="10" width="64" height="7" rx="3"/><rect x="4" y="21" width="56" height="4"/>
        <rect x="10" y="17" width="6" height="52"/><rect x="48" y="17" width="6" height="52"/>
      </g>
    </svg>`;
  }

  function leaves(n = 14) {
    const colors = ["var(--momiji)", "var(--shu)", "var(--gold)", "#b8452d", "#e0913a"];
    let out = "";
    for (let i = 0; i < n; i++) {
      const s = 12 + Math.random() * 16;
      out += `<span class="leaf" style="left:${Math.random() * 100}%;--s:${s}px;--c:${colors[i % colors.length]};--d:${9 + Math.random() * 9}s;--delay:${-Math.random() * 14}s;--x:${-60 + Math.random() * 140}px;--sd:${3 + Math.random() * 3}s"><svg><use href="#leaf"/></svg></span>`;
    }
    return `<div class="leaves" aria-hidden="true">${out}</div>`;
  }

  function renderHome() {
    const d = trip.days;
    const views = d.reduce((a, day) => a + day.items.filter((i) => ["view", "golden"].includes(kind(i))).length, 0);
    const hotels = new Set(d.map((x) => x.hotel).filter((h) => h && !h.startsWith("—"))).size;
    const driveDays = d.filter((x) => /กม\./.test(x.drive)).length;

    main.innerHTML = `
    <div class="view">
      <section class="hero">
        <div class="hero-sky"></div>
        ${heroArt()}
        ${leaves()}
        <div class="hero-jp" aria-hidden="true">晩秋の旅</div>
        <div class="hero-content">
          <h1>JAPAN <span>2026</span></h1>
          <p class="hero-sub">${esc(trip.subtitle.replace(/^晩秋\s*—\s*/, ""))}</p>
          <div class="hero-meta">
            <span class="chip">📅 29 ต.ค. – 8 พ.ย.</span>
            <span class="chip">🌙 11 วัน 10 คืน</span>
            <span class="chip">👥 4 ท่าน</span>
          </div>
          <div id="countdown"></div>
        </div>
      </section>

      <section class="section reveal">
        <div class="stats">
          <div class="card stat"><b>${d.length}</b><span>วันเที่ยว</span></div>
          <div class="card stat"><b>${driveDays}</b><span>วันขับรถเอง</span></div>
          <div class="card stat"><b>${views}</b><span>จุดชมวิว</span></div>
          <div class="card stat"><b>${hotels}</b><span>ที่พัก</span></div>
        </div>
      </section>

      <section class="section reveal">
        <div class="card overview"><p>${esc(trip.overview)}</p></div>
      </section>

      <section class="section">
        <div class="section-head reveal"><h2>โปรแกรม 11 วัน</h2><span class="kicker">Itinerary</span></div>
        <ol class="daylist">
          ${d.map((day) => `
          <li class="reveal ${day.n >= 9 ? "tokyo" : ""}">
            <span class="day-bullet">${day.n}</span>
            <a class="card day-card" href="#/day/${day.n}">
              <div class="d-date">${esc(day.dateLabel.replace(/\(.*\)/, ""))} · ${esc(day.weekday)}</div>
              <h3>${esc(day.title || day.route)}</h3>
              <div class="d-route">${esc(day.subtitle || day.route)}</div>
              <div class="d-meta">
                <span>🚀 ออก ${esc(day.depart)}</span>
                <span>${day.n >= 9 && day.n <= 10 ? "🚇" : day.n === 11 ? "🚌" : "🚗"} ${esc(day.drive)}</span>
                <span>🌇 ${esc(day.sunset)}</span>
                ${day.hotel && !day.hotel.startsWith("—") ? `<span>🏨 ${esc(day.hotel.split("—").pop().trim())}</span>` : ""}
              </div>
            </a>
          </li>`).join("")}
        </ol>
      </section>

      <section class="section reveal">
        <div class="section-head"><h2>สัญลักษณ์</h2></div>
        <div class="card" style="padding:14px">
          <div class="legend">
            <span class="badge gold">GOLDEN</span><span class="small muted">จุดชมแสงเย็นของวัน (ตะวันตก 16:39–16:53)</span>
          </div>
          <div class="legend" style="margin-top:8px">
            <span class="stars">★★★</span><span class="small muted">ห้ามพลาด</span>
            <span class="stars">★★</span><span class="small muted">คุ้มมาก</span>
            <span class="stars">★</span><span class="small muted">แวะได้ตามเวลา</span>
          </div>
          <div class="legend" style="margin-top:8px">
            <span class="badge blue">ยืดหยุ่น</span><span class="small muted">ตัดได้ถ้าเวลาไม่พอ</span>
            <span class="badge">🅰️ / 🅱️</span><span class="small muted">กลุ่มที่พักแยก 2 คืนแรก</span>
          </div>
          <p class="small muted" style="margin-top:10px">กดปุ่ม <b>🚗 โหมดคนขับ</b> มุมขวาบนเพื่อดูลิงก์นำทาง Google Maps และที่จอดรถของแต่ละจุด</p>
        </div>
      </section>
      ${footer()}
    </div>`;
    startCountdown();
  }

  function startCountdown() {
    clearInterval(countdownTimer);
    const el = $("#countdown");
    if (!el) return;
    const target = new Date(trip.firstFlight).getTime();
    const end = new Date(`${trip.end}T23:59:59+09:00`).getTime();
    const tick = () => {
      const now = Date.now();
      if (now >= end) { el.innerHTML = `<p class="countdown-note">ทริปจบแล้ว · ขอบคุณที่เดินทางด้วยกัน ありがとう 🍁</p>`; clearInterval(countdownTimer); return; }
      if (now >= target) { el.innerHTML = `<p class="countdown-note">よい旅を · ขอให้เป็นทริปที่ดี 🍁</p>`; clearInterval(countdownTimer); return; }
      let s = Math.floor((target - now) / 1000);
      const dd = Math.floor(s / 86400); s %= 86400;
      const hh = Math.floor(s / 3600); s %= 3600;
      const mm = Math.floor(s / 60); s %= 60;
      el.innerHTML = `<div class="countdown" aria-label="นับถอยหลังถึงวันเดินทาง">
        <div><b>${dd}</b><small>วัน</small></div><div><b>${pad(hh)}</b><small>ชั่วโมง</small></div>
        <div><b>${pad(mm)}</b><small>นาที</small></div><div><b>${pad(s)}</b><small>วินาที</small></div></div>
        <p class="countdown-note">✈️ XJ602 ออกจากดอนเมือง 01:40 · 29 ต.ค.</p>`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  const footer = () => `<footer class="footer"><span class="jp">よい旅を</span>ข้อมูลจากไฟล์วางแผน · อัปเดต ${esc(new Date(trip.generated).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }))}<br>เวลาเปิด-ปิดอาจเปลี่ยน ควรเช็ก Google Maps อีกครั้งก่อนไป</footer>`;

  /* ---------- rendering: day ---------- */
  function lotCard(lot, compact = false) {
    const url = safeUrl(lot.url), alt = safeUrl(lot.altUrl), tel = firstPhone(lot.phone);
    return `
      <div class="${compact ? "" : "card "}plot">
        <div class="plot-head"><div>
          ${compact ? "" : `<div class="small muted">${esc(lot.dayLabel)}</div>`}
          <h3>${esc(lot.place)}</h3>
          <div class="lotname">🅿️ ${esc(lot.lot || "")}</div>
        </div></div>
        <dl>
          ${lot.fee ? `<dt>ค่าจอด</dt><dd>${esc(lot.fee)}</dd>` : ""}
          ${lot.limits ? `<dt>ข้อจำกัด</dt><dd>${esc(lot.limits)}</dd>` : ""}
          ${lot.walk ? `<dt>เดินถึงจุด</dt><dd>${esc(lot.walk)}</dd>` : ""}
          ${lot.alt ? `<dt>ลานสำรอง</dt><dd>${esc(lot.alt)}</dd>` : ""}
          ${lot.phone ? `<dt>โทร</dt><dd>${telLinks(lot.phone)}</dd>` : ""}
        </dl>
        <div class="btn-row${tel && !alt ? "" : ""}">
          ${url ? `<a class="btn btn-primary btn-sm" href="${esc(url)}" target="_blank" rel="noopener">🧭 นำทางลานหลัก</a>` : ""}
          ${alt ? `<a class="btn btn-ghost btn-sm" href="${esc(alt)}" target="_blank" rel="noopener">🔁 ลานสำรอง</a>`
                : tel ? `<a class="btn btn-ghost btn-sm" href="${tel}">📞 โทร</a>` : ""}
        </div>
      </div>`;
  }

  function itemHtml(item, idx, lots) {
    const k = kind(item);
    const [t1, t2] = splitTime(item.time);
    const move = isMoveRow(item);
    const flexible = /ยืดหยุ่น/.test(item.duration || "");
    const classes = ["t-item", `c-${k}`, move ? "move" : "", k === "cut" ? "cut" : "", k === "backup" ? "backupItem" : ""].join(" ");
    const badges = [
      k === "golden" ? `<span class="badge gold">🌅 GOLDEN HOUR</span>` : "",
      item.closedWarning ? `<span class="badge red">⚠️ ${esc(item.closedWarning)}</span>` : "",
      flexible ? `<span class="badge blue">ยืดหยุ่น</span>` : "",
      item.booking ? `<span class="badge ${/จองแล้ว/.test(item.booking) ? "green" : ""}">${/จองแล้ว/.test(item.booking) ? "✓ " : "🎫 "}${esc(item.booking)}</span>` : "",
      item.yen ? `<span class="badge">≈ ¥${item.yen.toLocaleString()}/คน</span>` : "",
    ].join("");

    if (move) {
      return `
      <li class="${classes}">
        <div class="t-time">${esc(t1)}</div><span class="t-dot" aria-hidden="true"></span>
        <div class="t-card">
          <h3>${esc(item.type.split(" ")[0])} ${esc(item.name)}</h3>
          <div class="move-meta">${esc((item.duration || "").replace(/^[🚗🚇⏱]\S*\s*/u, ""))}</div>
          ${item.detail ? `<div class="t-detail">${item.detail.map(esc).join(" · ")}</div>` : ""}
        </div>
      </li>`;
    }

    const detail = item.detail || [];
    const longDetail = detail.join(" ").length > 160;
    const parkingText = item.parking || [];
    const matched = lots.byItem.get(idx) || [];

    return `
    <li class="${classes} reveal">
      <div class="t-time">${esc(t1)}${t2 ? `<small>${esc(t2)}</small>` : ""}</div>
      <span class="t-dot" aria-hidden="true"></span>
      <article class="card t-card">
        <div class="t-type">${esc(item.type)} ${stars(item.stars)}</div>
        <h3>${esc(item.name)}</h3>
        ${badges ? `<div class="badges">${badges}</div>` : ""}
        <div class="t-info">
          ${item.hours ? `<div><span>🕘</span><span>${esc(item.hours)}</span></div>` : ""}
          ${item.limits ? `<div><span>📌</span><span>${esc(item.limits)}</span></div>` : ""}
          ${item.duration ? `<div><span>⏳</span><span>${esc(item.duration.replace(/^⏱\s*/, ""))}</span></div>` : ""}
        </div>
        ${detail.length ? `<div class="t-detail ${longDetail ? "clamp" : ""}">${detail.map((p) => `<p>${telLinks(p)}</p>`).join("")}</div>
          ${longDetail ? `<button class="more-btn" type="button" data-more>อ่านต่อ ▾</button>` : ""}` : ""}
        ${(item.rule || []).map((r) => `<div class="sub rule"><b>⏱ เกณฑ์ตัดสินหน้างาน</b>${esc(r)}</div>`).join("")}
        ${(item.backup || []).map((b) => `<div class="sub backup"><b>🔁 แผนสำรอง</b>${telLinks(b)}</div>`).join("")}
        ${(parkingText.length || matched.length) ? `
          <div class="sub park driver-only">
            <b>🅿️ ที่จอด</b>${parkingText.map(esc).join("<br>")}
            ${matched.map((lot) => {
              const u = safeUrl(lot.url), a = safeUrl(lot.altUrl);
              return `${matched.length > 1 ? `<span class="lot-label">${esc(lot.place)}</span>` : ""}<div class="btn-row">
                ${u ? `<a class="btn btn-primary btn-sm" href="${esc(u)}" target="_blank" rel="noopener">🧭 นำทางลานจอด</a>` : ""}
                ${a ? `<a class="btn btn-ghost btn-sm" href="${esc(a)}" target="_blank" rel="noopener">🔁 ลานสำรอง</a>` : (firstPhone(lot.phone) ? `<a class="btn btn-ghost btn-sm" href="${firstPhone(lot.phone)}">📞 โทร</a>` : "")}
              </div>`;
            }).join("")}
          </div>` : ""}
      </article>
    </li>`;
  }

  function routesHtml(day) {
    if (!day.routes.length) return "";
    return `
    <section class="card navblock driver-only reveal">
      <h2>🧭 นำทางวันนี้</h2>
      <p class="small muted">เปิดเส้นทางพร้อมจุดแวะตามลำดับใน Google Maps · ถึงโซนแล้วกดปุ่ม 🅿️ ของแต่ละจุดด้านล่าง</p>
      ${day.routes.map((r) => `
        <div class="route ${r.backup ? "backup" : ""}">
          <div class="route-head"><b>${r.backup ? "🔁 " : ""}${esc(r.label)} · ${esc(r.title)}</b><span>${esc(r.distance)}</span></div>
          <div class="stops">${r.stops.map((s, i) => `${i ? "<i>→</i>" : ""}<span>${esc(s)}</span>`).join("")}</div>
          ${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}
          ${safeUrl(r.url) ? `<a class="btn ${r.mode === "drive" ? "btn-primary" : "btn-dark"} btn-block" href="${esc(r.url)}" target="_blank" rel="noopener">
            ${r.mode === "drive" ? "🚗 เปิดเส้นทางขับรถ" : r.mode === "walk" ? "🚶 เปิดเส้นทางเดิน" : "🚇 เปิดเส้นทาง"}</a>` : ""}
        </div>`).join("")}
    </section>`;
  }

  function renderDay(n) {
    const day = trip.days.find((d) => d.n === n) || trip.days[0];
    store.set("jp26-day", String(day.n));
    $('[data-tab="day"]').setAttribute("href", `#/day/${day.n}`);
    const lots = matchParking(day);
    const hotel = day.hotel && !day.hotel.startsWith("—") ? day.hotel : "";

    main.innerHTML = `
    <div class="view" id="dayView">
      <nav class="daynav" aria-label="เลือกวัน">
        ${trip.days.map((d) => `<a href="#/day/${d.n}" ${d.n === day.n ? 'aria-current="true"' : ""}><b>${d.n}</b><small>${esc(d.dateLabel.replace(/\s*\(.*\)/, ""))}</small></a>`).join("")}
      </nav>

      <header class="day-hero">
        <span class="day-num" aria-hidden="true">${pad(day.n)}</span>
        <span class="kicker">Day ${day.n} · ${esc(day.dateLabel.replace(/\s*\(.*\)/, ""))} · ${esc(day.weekday)}</span>
        <h1>${esc(day.title || day.route)}</h1>
        <p class="subtitle">${esc(day.subtitle || day.route)}</p>
        ${day.intro ? `<p class="intro">${esc(day.intro)}</p>` : ""}
        <div class="facts">
          <div class="card fact"><small>ออกเดินทาง</small><b>${esc(day.depart)}</b></div>
          <div class="card fact"><small>การเดินทาง</small><b>${esc(day.drive)}</b></div>
          <div class="card fact"><small>ตะวันขึ้น / ตก</small><b>🌅 ${esc(day.sunrise)} · 🌇 ${esc(day.sunset)}</b></div>
          <div class="card fact"><small>ที่พักคืนนี้</small><b>${esc(hotel || "กลับกรุงเทพ ✈️")}</b></div>
        </div>
        ${day.alerts.map((a) => `
          <div class="alert"><span class="a-icon">⚠️</span><div><b>${esc(a.name)}</b>
          ${a.limits ? `<span>${esc(a.limits)}</span>` : ""}
          ${a.detail ? `<div class="small">${a.detail.map(esc).join(" ")}</div>` : ""}</div></div>`).join("")}
      </header>

      ${routesHtml(day)}

      <ol class="timeline">
        ${day.items.map((item, i) => itemHtml(item, i, lots)).join("")}
      </ol>

      ${day.notes.length ? `
      <section class="section">
        <div class="section-head"><h2>หมายเหตุของวัน</h2></div>
        ${day.notes.map((nt) => `<div class="alert tip reveal"><span class="a-icon">💡</span><div><b>${esc(nt.name)}</b>
          ${nt.hours ? `<div class="small">🕘 ${esc(nt.hours)}</div>` : ""}
          ${nt.limits ? `<div class="small">📌 ${esc(nt.limits)}</div>` : ""}
          ${nt.detail ? `<div class="small">${nt.detail.map(telLinks).join(" ")}</div>` : ""}</div></div>`).join("")}
      </section>` : ""}

      ${lots.lots.length ? `
      <section class="section driver-only">
        <details class="card group">
          <summary>🅿️ ที่จอดทั้งหมดของวันนี้ <small>${lots.lots.length} จุด</small></summary>
          ${lots.lots.map((l) => `<div class="g-row">${lotCard(l, true)}</div>`).join("")}
        </details>
      </section>` : ""}

      <div class="btn-row section">
        ${day.n > 1 ? `<a class="btn btn-ghost" href="#/day/${day.n - 1}">← Day ${day.n - 1}</a>` : "<span></span>"}
        ${day.n < trip.days.length ? `<a class="btn btn-ghost" href="#/day/${day.n + 1}">Day ${day.n + 1} →</a>` : `<a class="btn btn-ghost" href="#/">หน้าแรก ⛩️</a>`}
      </div>
      ${footer()}
    </div>`;

    const active = $(".daynav [aria-current]");
    if (active) active.scrollIntoView({ inline: "center", block: "nearest" });
    enableSwipe(day.n);
  }

  function enableSwipe(n) {
    const view = $("#dayView");
    let x0 = null, y0 = null;
    view.addEventListener("touchstart", (e) => {
      if (e.target.closest(".daynav, .stops, a, button")) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    view.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
        const next = n + (dx < 0 ? 1 : -1);
        if (next >= 1 && next <= trip.days.length) location.hash = `#/day/${next}`;
      }
      x0 = null;
    }, { passive: true });
  }

  /* ---------- rendering: parking ---------- */
  function renderParking(filter) {
    const days = [...new Set(trip.parking.flatMap((l) => l.days))].sort((a, b) => a - b);
    const f = Number(filter) || 0;
    const list = trip.parking.filter((l) => !f || l.days.includes(f));
    main.innerHTML = `
    <div class="view">
      <header class="day-hero">
        <span class="kicker">Parking</span>
        <h1>🅿️ ที่จอดรถ Day 1–8</h1>
        <p class="intro">ใช้ลิงก์เส้นทางของวันพาไปถึงโซน แล้วกด "นำทางลานหลัก" สำหรับช่วงสุดท้าย · ถ้าเต็มกดลานสำรอง · GPS ในรถเช่าค้นด้วยเบอร์โทรได้แม่นกว่าชื่อ</p>
      </header>
      <div class="pfilter" role="group" aria-label="กรองตามวัน">
        <button type="button" data-pf="0" aria-pressed="${!f}">ทั้งหมด</button>
        ${days.map((d) => `<button type="button" data-pf="${d}" aria-pressed="${f === d}">Day ${d}</button>`).join("")}
      </div>
      ${list.map((l) => lotCard(l)).join("") || `<p class="empty">ไม่มีข้อมูล</p>`}
      ${footer()}
    </div>`;
    $$("[data-pf]").forEach((b) => b.addEventListener("click", () => {
      location.hash = b.dataset.pf === "0" ? "#/parking" : `#/parking/${b.dataset.pf}`;
    }));
  }

  /* ---------- rendering: guides ---------- */
  const GUIDES = [
    ["food", "🍡 อาหาร & ของฝาก"],
    ["tokyo", "🗼 โตเกียวรายย่าน"],
    ["fuji", "🗻 จุดชมฟูจิ"],
    ["pretrip", "🎒 เตรียมตัว"],
  ];

  function guideRow(key, r) {
    if (key === "food") return `
      <div class="g-row" data-q>
        <h4>${esc(r.name)} ${stars(r.stars)}</h4>
        <p>${esc(r.detail || "")}</p>
        <div class="g-meta">${r.category ? `<span>${esc(r.category)}</span>` : ""}${r.shop ? `<span>📍 ${esc(r.shop)}</span>` : ""}${r.price ? `<span>💴 ${esc(r.price)}</span>` : ""}${r.day ? `<span class="badge">${esc(r.day)}</span>` : ""}</div>
      </div>`;
    if (key === "tokyo") return `
      <div class="g-row" data-q>
        <h4>${esc(r.name)} ${stars(r.stars)}</h4>
        <p>${esc(r.detail || "")}</p>
        <div class="g-meta">${r.category ? `<span>${esc(r.category)}</span>` : ""}${r.price ? `<span>💴 ${esc(r.price)}</span>` : ""}${r.hours ? `<span>🕘 ${esc(r.hours)}</span>` : ""}${r.station ? `<span>🚉 ${esc(r.station)}</span>` : ""}</div>
      </div>`;
    if (key === "fuji") return `
      <div class="g-row" data-q>
        <h4>${esc(r.name)} ${stars(r.stars)} ${r.day ? `<span class="badge green">${esc(r.day)}</span>` : ""}</h4>
        <p>${esc(r.view || "")}</p>
        <div class="g-meta">${r.light ? `<span>☀️ ${esc(r.light)}</span>` : ""}${r.access ? `<span>🚶 ${esc(r.access)}</span>` : ""}${r.fee ? `<span>💴 ${esc(r.fee)}</span>` : ""}${r.distance ? `<span>📏 ${esc(r.distance)}</span>` : ""}</div>
        ${r.note ? `<p class="small muted">${esc(r.note)}</p>` : ""}
      </div>`;
    return `
      <div class="g-row" data-q>
        <h4>${esc(r.task)} ${r.priority ? `<span class="badge ${/สูง/.test(r.priority) ? "red" : ""}">${esc(r.priority)}</span>` : ""}</h4>
        ${r.detail ? `<p>${esc(r.detail)}</p>` : ""}
      </div>`;
  }

  function renderGuide(key) {
    if (!GUIDES.some(([k]) => k === key)) key = "food";
    const groups = trip.guides[key] || [];
    const intro = {
      food: "อาหารท้องถิ่นและของฝากแยกตามเมือง นอกโตเกียว · ★★ ขึ้นไปคือของที่มีเฉพาะที่นั่น",
      tokyo: "คู่มือร้าน คาเฟ่ และช็อปปิ้งรายย่านในโตเกียว · ใช้คู่กับ Day 9–10",
      fuji: "แค็ตตาล็อกจุดชมวิวฟูจิ 10 โซน รวมจุดที่ยังไม่อยู่ในแผน · เดือนพฤศจิกายนฟูจิเปิดให้เห็นเฉลี่ยราว 40% ของวัน",
      pretrip: "สิ่งที่ต้องเตรียมก่อนเดินทาง และสิ่งที่ต้องเช็กระหว่างทริป",
    }[key];
    main.innerHTML = `
    <div class="view">
      <header class="day-hero">
        <span class="kicker">Guide</span>
        <h1>${esc(GUIDES.find(([k]) => k === key)[1])}</h1>
        <p class="intro">${esc(intro)}</p>
      </header>
      <nav class="seg" aria-label="หมวดคู่มือ">
        ${GUIDES.map(([k, label]) => `<a href="#/guide/${k}" ${k === key ? 'aria-current="page"' : ""}>${esc(label)}</a>`).join("")}
      </nav>
      <input class="search" type="search" placeholder="ค้นหา เช่น ramen, Kamakura, ปิดวันพุธ" aria-label="ค้นหาในคู่มือ" id="gsearch">
      ${key === "pretrip" && trip.packing.length ? `
        <details class="card group" open>
          <summary>🧳 ของที่ต้องเตรียม <small>${trip.packing.length} รายการ</small></summary>
          <ul class="checklist">${trip.packing.map((p) => `<li data-q>${esc(p)}</li>`).join("")}</ul>
        </details>` : ""}
      ${groups.map((g, i) => `
        <details class="card group" ${i < 2 ? "open" : ""}>
          <summary>${esc(g.group.replace(/^[A-Z0-9]+\.\s*/, ""))} <small>${g.rows.length} รายการ</small></summary>
          ${g.rows.map((r) => guideRow(key, r)).join("")}
        </details>`).join("")}
      ${footer()}
    </div>`;
    $("#gsearch").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$("details.group").forEach((det) => {
        let hits = 0;
        $$("[data-q]", det).forEach((row) => {
          const ok = !q || row.textContent.toLowerCase().includes(q);
          row.hidden = !ok;
          if (ok) hits++;
        });
        det.hidden = hits === 0;
        if (q && hits) det.open = true;
      });
    });
  }

  /* ---------- rendering: share ---------- */
  function renderShare() {
    const url = location.href.split("#")[0];
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    main.innerHTML = `
    <div class="view">
      <header class="day-hero">
        <span class="kicker">Share</span>
        <h1>📲 แชร์ให้เพื่อน & ติดตั้งแอป</h1>
        <p class="intro">สแกน QR หรือส่งลิงก์ให้เพื่อนร่วมทริป · ติดตั้งลงหน้าจอหลักเพื่อเปิดได้แม้ไม่มีสัญญาณ</p>
      </header>
      <section class="card share-card reveal">
        <div class="qr"><img src="icons/qr.svg" alt="QR code ของเว็บไซต์ทริป" width="220" height="220"></div>
        <div class="url-box">${esc(url)}</div>
        <div class="btn-row">
          <button class="btn btn-primary" type="button" id="shareBtn">📤 แชร์ลิงก์</button>
          <button class="btn btn-ghost" type="button" id="copyBtn">📋 คัดลอก</button>
        </div>
      </section>

      <section class="card share-card section reveal">
        <h2 style="font-size:18px">📱 ติดตั้งลงหน้าจอหลัก</h2>
        ${standalone ? `<p class="small muted" style="margin-top:8px">✓ ติดตั้งแล้ว — เปิดจากไอคอนบนหน้าจอได้เลย</p>` : `
        <button class="btn btn-dark btn-block" type="button" id="installBtn" style="margin-top:12px" ${deferredInstall ? "" : "hidden"}>⬇️ ติดตั้งแอป</button>
        <ol class="steps">
          ${isIOS ? `<li>เปิดหน้านี้ใน <b>Safari</b></li><li>แตะปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรขึ้น)</li><li>เลือก <b>เพิ่มไปยังหน้าจอโฮม</b></li>`
                  : `<li>เปิดใน <b>Chrome</b> แล้วกดปุ่ม "ติดตั้งแอป" ด้านบน</li><li>หรือเมนู ⋮ → <b>เพิ่มลงในหน้าจอหลัก</b></li>`}
        </ol>`}
      </section>

      <section class="card share-card section reveal" style="text-align:left">
        <h2 style="font-size:18px">📶 ใช้งานแบบออฟไลน์</h2>
        <ol class="steps">
          <li>เปิดเว็บนี้ให้ครบทุกหน้าอย่างน้อย 1 ครั้งตอนมี Wi-Fi ข้อมูลจะถูกเก็บในเครื่อง</li>
          <li>ลิงก์นำทางเปิดในแอป Google Maps ซึ่งต้องใช้อินเทอร์เน็ต · <b>ดาวน์โหลดแผนที่ออฟไลน์</b> โซน Yamanashi, Shizuoka, Izu และ Kanagawa ไว้ก่อน เพราะสัญญาณบน Nishi-Izu ขาดเป็นช่วง</li>
        </ol>
        <p class="small muted" style="margin-top:10px" id="cacheStatus"></p>
      </section>
      ${footer()}
    </div>`;

    $("#shareBtn").addEventListener("click", async () => {
      if (navigator.share) {
        try { await navigator.share({ title: "Japan 2026 · 晩秋の旅", text: "โปรแกรมทริปญี่ปุ่น 29 ต.ค. – 8 พ.ย.", url }); } catch { /* cancelled */ }
      } else copy(url);
    });
    $("#copyBtn").addEventListener("click", () => copy(url));
    const ib = $("#installBtn");
    if (ib) ib.addEventListener("click", async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      ib.hidden = true;
    });
    if ("caches" in window) {
      caches.keys().then((keys) => {
        $("#cacheStatus") && ($("#cacheStatus").textContent = keys.some((k) => k.startsWith("jp26"))
          ? "✓ บันทึกข้อมูลสำหรับออฟไลน์แล้ว" : "ยังไม่ได้บันทึกข้อมูลออฟไลน์ (เปิดหน้าเว็บอีกครั้งตอนมีเน็ต)");
      });
    }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("คัดลอกลิงก์แล้ว"); }
    catch { toast(text); }
  }

  /* ---------- router ---------- */
  function route() {
    clearInterval(countdownTimer);
    const [, page, arg] = (location.hash || "#/").replace(/^#\/?/, "/").split("/");
    let tab = "home";
    if (page === "day") { renderDay(Number(arg) || 1); tab = "day"; }
    else if (page === "parking") { renderParking(arg); tab = "parking"; }
    else if (page === "guide") { renderGuide(arg); tab = "guide"; }
    else if (page === "share") { renderShare(); tab = "share"; }
    else renderHome();

    $$(".tabbar a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.tab === tab));
    $$(".tabbar a[aria-current]").forEach((a) => a.setAttribute("aria-current", "page"));
    window.scrollTo({ top: 0, behavior: "instant" });
    observeReveal();
  }

  let io = null;
  function observeReveal() {
    const els = $$(".reveal");
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    io?.disconnect();
    io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    els.forEach((e) => io.observe(e));
  }

  /* ---------- global events ---------- */
  document.addEventListener("click", (e) => {
    const more = e.target.closest("[data-more]");
    if (more) {
      const d = more.previousElementSibling;
      const open = d.classList.toggle("clamp");
      more.textContent = open ? "อ่านต่อ ▾" : "ย่อ ▴";
    }
    const btn = e.target.closest(".btn");
    if (btn) {
      const r = btn.getBoundingClientRect();
      const s = document.createElement("span");
      const size = Math.max(r.width, r.height);
      s.className = "ripple";
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      btn.appendChild(s);
      setTimeout(() => s.remove(), 600);
    }
  });

  $("#modeToggle").addEventListener("click", () => {
    const on = !document.body.classList.contains("driver");
    applyDriver(on);
    store.set("jp26-driver", on ? "1" : "0");
    toast(on ? "🚗 โหมดคนขับ: แสดงปุ่มนำทางและที่จอด" : "👀 โหมดอ่านโปรแกรม");
    if (!on && location.hash.startsWith("#/parking")) location.hash = "#/";
    observeReveal();
  });

  $("#themeToggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    applyTheme(next);
    store.set("jp26-theme", next);
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    const ib = $("#installBtn");
    if (ib) ib.hidden = false;
  });

  const updateOnline = () => { $("#offlinePill").hidden = navigator.onLine; };
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);

  /* ---------- boot ---------- */
  applyTheme(store.get("jp26-theme"));
  applyDriver(store.get("jp26-driver") === "1");
  const lastDay = store.get("jp26-day");
  if (lastDay) $('[data-tab="day"]').setAttribute("href", `#/day/${lastDay}`);
  updateOnline();

  fetch("data/trip.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      trip = data;
      lotsById = new Map(trip.parking.map((l) => [l.id, l]));
      window.addEventListener("hashchange", route);
      route();
    })
    .catch(() => {
      main.innerHTML = `<div class="empty"><p>โหลดข้อมูลไม่สำเร็จ 😢</p><p class="small">ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่</p>
        <button class="btn btn-primary" style="margin-top:12px" onclick="location.reload()">ลองอีกครั้ง</button></div>`;
    });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
