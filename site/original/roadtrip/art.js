/* Japan 2026 — Road trip: paper-cut ukiyo-e artwork, all drawn in code.
 * Scene units: every layer is 740 tall; the road top sits at RY. Scrolling layers are
 * TW wide and tile seamlessly (hills are sums of whole-period sines, rows repeat evenly).
 * Exposes window.ART.
 */
(() => {
  "use strict";
  const C = { washi: "#F3E9D2", ai: "#1F3A5F", shu: "#C8442F", momiji: "#E07B39", matsu: "#3E5C4A", sumi: "#1B1B1B", kin: "#E9B44C" };
  const H = 740, RY = 520, TW = 1400;

  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const f1 = (n) => Math.round(n * 10) / 10;

  const DEFS = `<defs>
    <filter id="paper" x="-5%" y="-5%" width="110%" height="115%">
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feDropShadow in="d" dx="0" dy="2.2" stdDeviation="1.6" flood-color="#2a1c0c" flood-opacity=".28"/>
    </filter>
    <filter id="paperLite" x="-5%" y="-5%" width="110%" height="115%">
      <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>`;
  const doc = (w, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${DEFS}${inner}</svg>`;

  /* ---------------- scenery pieces ---------------- */
  // Periodic ridge: whole-number cycles over TW so the strip tiles without a seam.
  function ridge(y, amp, color, seed, filter = "paper", w = TW) {
    const r = rng(seed), waves = [1, 2, 3, 5, 7].map((k) => [k * (w / TW), (r() * 0.8 + 0.2) / k, r() * Math.PI * 2]);
    let d = `M0 ${H}`;
    for (let x = 0; x <= w; x += 20) {
      let v = 0; for (const [k, a, p] of waves) v += a * Math.sin((x / w) * Math.PI * 2 * k * (TW / w) + p);
      d += ` L${x} ${f1(y - amp * (0.5 + v / 2.4))}`;
    }
    return `<path d="${d} L${w} ${H} Z" fill="${color}" filter="url(#${filter})"/>`;
  }
  const spots = (seed, n, lo = 40, hi = TW - 40) => { const r = rng(seed); return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * (i + r() * 0.7)) / n); };
  function fuji(cx, base, w, h, body = "#4F6D8F", snow = "#FBF7EE", id = "fj") {
    const d = `M${cx - w / 2} ${base} C${cx - w * .26} ${base - h * .3} ${cx - w * .12} ${base - h * .86} ${cx - w * .07} ${base - h} L${cx + w * .07} ${base - h} C${cx + w * .12} ${base - h * .86} ${cx + w * .26} ${base - h * .3} ${cx + w / 2} ${base} Z`;
    const sy = base - h * .6; let zz = `M${cx - w / 2} ${base - h - 5} L${cx + w / 2} ${base - h - 5} L${cx + w / 2} ${sy}`;
    for (let i = 9; i >= 0; i--) zz += ` L${cx - w / 2 + (w * i) / 9} ${sy + (i % 2 ? h * .1 : -h * .02) + (i % 3 === 0 ? h * .05 : 0)}`;
    return `<g filter="url(#paper)"><clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${body}"/><path d="${zz}Z" fill="${snow}" clip-path="url(#${id})"/></g>`;
  }
  const cloud = (x, y, s, c = "#FBF5E6") =>
    `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#paper)"><path d="M0 20 Q4 6 18 8 Q24 -4 40 2 Q52 -6 62 6 Q78 4 80 20 Z" fill="${c}"/></g>`;
  const pine = (x, y, s, c = C.matsu) =>
    `<g transform="translate(${f1(x)} ${y}) scale(${s})" filter="url(#paper)"><path d="M-2 0 L-3 -30 Q0 -40 4 -50 L3 -30 L2 0Z" fill="#5a3b22"/>` +
    `<ellipse cx="-12" cy="-30" rx="16" ry="6" fill="${c}"/><ellipse cx="10" cy="-42" rx="18" ry="6.5" fill="${c}"/><ellipse cx="-4" cy="-56" rx="14" ry="6" fill="${c}"/><ellipse cx="6" cy="-66" rx="9" ry="4.5" fill="${c}"/></g>`;
  const maple = (x, y, s, c = C.momiji) =>
    `<g transform="translate(${f1(x)} ${y}) scale(${s})" filter="url(#paper)"><path d="M-2 0 L-2.5 -26 L2.5 -26 L2 0Z" fill="#5a3b22"/>` +
    `<circle cx="0" cy="-40" r="17" fill="${c}"/><circle cx="-13" cy="-31" r="11" fill="${c}"/><circle cx="13" cy="-30" r="12" fill="${C.shu}"/><circle cx="4" cy="-52" r="10" fill="${C.kin}" opacity=".9"/></g>`;
  const bamboo = (x, y, h, c) => { let s = `<rect x="${f1(x)}" y="${y - h}" width="7" height="${h}" fill="${c}"/>`; for (let yy = y - 30; yy > y - h; yy -= 34) s += `<rect x="${f1(x - 1)}" y="${yy}" width="9" height="2.4" fill="rgb(0 0 0 / .18)"/>`; return s + `<path d="M${f1(x + 3)} ${y - h + 6} q14 -8 26 -2 q-14 2 -26 8Z" fill="${c}"/>`; };
  function water(y, y2, c1, c2, lines = 6, w = TW) {
    let s = `<rect x="0" y="${y}" width="${w}" height="${y2 - y}" fill="${c1}"/><rect x="0" y="${f1(y + (y2 - y) * .5)}" width="${w}" height="${f1((y2 - y) * .5)}" fill="${c2}"/>`;
    for (let row = 0; row < lines; row++) { const yy = y + 8 + row * 12; if (yy > y2 - 4) break; let d = ""; for (let x = (row % 2) * 14; x < w; x += 28) d += `M${x} ${yy} q7 -5 14 0 `; s += `<path d="${d}" stroke="${C.washi}" stroke-opacity="${f1(.55 - row * .07)}" stroke-width="1.3" fill="none"/>`; }
    return s;
  }
  function bigWave(x, y, s, seed = 11) {
    let foam = ""; const r = rng(seed);
    for (let i = 0; i < 9; i++) { const a = -2.6 + i * .28; foam += `<circle cx="${f1(130 + Math.cos(a) * 63)}" cy="${f1(-62 + Math.sin(a) * 56)}" r="${f1(3 + r() * 3)}" fill="${C.washi}"/>`; }
    return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#paper)">` +
      `<path d="M-40 0 C0 -40 40 -120 130 -126 C182 -128 206 -92 186 -64 C176 -84 156 -92 138 -84 C116 -74 114 -44 134 -22 C104 -30 86 -12 96 0 Z" fill="${C.ai}"/>` +
      `<path d="M-20 -6 C20 -44 56 -112 130 -118 C172 -120 192 -96 182 -76" fill="none" stroke="#6f97bd" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M10 -20 C40 -50 70 -92 120 -100" fill="none" stroke="${C.washi}" stroke-width="2" stroke-opacity=".7"/>${foam}</g>`;
  }
  const cliff = (x, y, w, h, c = "#7a5236") =>
    `<path d="M${x} ${y} L${x} ${y - h * .7} Q${x + w * .2} ${y - h} ${x + w * .45} ${y - h * .92} Q${x + w * .7} ${y - h * .98} ${x + w} ${y - h * .6} L${x + w * .92} ${y}Z" fill="${c}" filter="url(#paper)"/>`;
  function buildings(y, seed, { night = false, tall = 150, palette, lights = 0, lightC = "", neon = [] }) {
    const r = rng(seed); let s = "", x = 0;
    while (x < TW - 30) {
      let w = 26 + r() * 40; if (x + w > TW) w = TW - x;
      const h = 40 + r() * tall, c = palette[Math.floor(r() * palette.length)];
      s += `<rect x="${f1(x)}" y="${f1(y - h)}" width="${f1(w)}" height="${f1(h)}" fill="${c}"/>`;
      if (lights) for (let wy = y - h + 8; wy < y - 8; wy += 10) for (let wx = x + 5; wx < x + w - 6; wx += 8) if (r() < lights) s += `<rect x="${f1(wx)}" y="${f1(wy)}" width="3.4" height="4.4" fill="${lightC || (r() < .7 ? C.kin : "#f6d8a8")}"/>`;
      if (!night && r() < .3) s += `<rect x="${f1(x + w * .3)}" y="${f1(y - h - 8)}" width="6" height="8" fill="${c}"/>`;
      x += w + 2;
    }
    for (const [nx, ny, txt, col] of neon) s += `<rect x="${nx - 5}" y="${ny - 16}" width="${txt.length * 16 + 10}" height="24" rx="3" fill="${col}" filter="url(#glow)" opacity=".85"/><rect x="${nx - 5}" y="${ny - 16}" width="${txt.length * 16 + 10}" height="24" rx="3" fill="#120e1c" stroke="${col}" stroke-width="2"/><text x="${nx}" y="${ny + 1}" font-family="'Noto Sans JP',sans-serif" font-weight="900" font-size="15" fill="${col}">${txt}</text>`;
    return `<g filter="url(#paperLite)">${s}</g>`;
  }
  const tower = (x, y, s) =>
    `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#paper)"><path d="M-30 0 L-4 -150 L4 -150 L30 0 L20 0 L0 -120 L-20 0Z" fill="${C.shu}"/><rect x="-14" y="-70" width="28" height="6" fill="${C.washi}"/><rect x="-9" y="-112" width="18" height="5" fill="${C.washi}"/><rect x="-1" y="-178" width="2" height="30" fill="${C.shu}"/></g>`;
  const templeRoof = (x, y, s, c = "#3d3a3a") =>
    `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#paper)"><rect x="-34" y="-30" width="68" height="30" fill="#8a3b2c"/><path d="M-56 -26 Q0 -40 56 -26 L44 -46 Q0 -56 -44 -46Z" fill="${c}"/><rect x="-22" y="-62" width="44" height="14" fill="#8a3b2c"/><path d="M-38 -58 Q0 -70 38 -58 L28 -74 Q0 -82 -28 -74Z" fill="${c}"/></g>`;
  const teaRows = (y0, n, seed) => {
    const r = rng(seed); let s = "";
    for (let i = 0; i < n; i++) { const y = y0 + i * 14, c = i % 2 ? "#5d8a4a" : "#6f9d55"; let d = `M0 ${y + 10}`; for (let x = 0; x <= TW; x += 35) d += ` Q${x + 17} ${y - 4 - r() * 3} ${x + 35} ${y + 6}`; s += `<path d="${d} L${TW} ${y + 18} L0 ${y + 18}Z" fill="${c}"/>`; }
    return `<g filter="url(#paperLite)">${s}</g>`;
  };
  function road(y = RY) {
    let d = ""; for (let x = 6; x < TW; x += 40) d += `<rect x="${x}" y="${y + 19}" width="20" height="3" rx="1.5" fill="${C.washi}" opacity=".85"/>`;
    let tufts = ""; const r = rng(4); for (let x = 10; x < TW; x += 70) tufts += `<path d="M${f1(x + r() * 30)} ${y + 46} l4 -8 l2 8 l5 -10 l1 10Z" fill="#8f7a55"/>`;
    return `<rect x="0" y="${y}" width="${TW}" height="42" fill="#3b3632"/><rect x="0" y="${y}" width="${TW}" height="4" fill="#d8cbb0"/>${d}<rect x="0" y="${y + 42}" width="${TW}" height="${H - y - 42}" fill="#b49b72"/><rect x="0" y="${y + 42}" width="${TW}" height="3" fill="#9c845e"/>${tufts}`;
  }
  function rail(y = RY) {
    let s = `<rect x="0" y="${y}" width="${TW}" height="16" fill="#2a2f3d"/><rect x="0" y="${y}" width="${TW}" height="3" fill="#6b7287"/><rect x="0" y="${y + 16}" width="${TW}" height="${H - y - 16}" fill="#3a3f4f"/>`;
    for (let x = 30; x < TW; x += 140) s += `<rect x="${x}" y="${y + 16}" width="14" height="${H - y - 16}" fill="#2a2f3d"/><rect x="${x - 6}" y="${y + 16}" width="26" height="6" fill="#2a2f3d"/>`;
    for (let x = 0; x < TW; x += 20) s += `<rect x="${x}" y="${y - 3}" width="2" height="3" fill="#6b7287"/>`;
    return s;
  }

  /* ---------------- biomes: layers back to front ---------------- */
  // f = parallax factor (0 = fixed, 1 = road speed). fixed layers are drawn once at width FW and centred.
  const FW = 1400;
  const trees = (seed, n, y, mix = .5, s0 = 1) => { const r = rng(seed + 1); return spots(seed, n).map((x) => (r() < mix ? pine(x, y, s0 * (.85 + r() * .4)) : maple(x, y, s0 * (.85 + r() * .35), r() < .5 ? C.momiji : C.shu))).join(""); };
  const clouds = (seed, n) => { const r = rng(seed); return spots(seed, n).map((x) => cloud(x, 70 + r() * 160, .7 + r() * .6)).join(""); };

  const BIOMES = {
    airport: () => [
      { f: 0.03, svg: clouds(5, 5) },
      { f: 0.08, svg: ridge(476, 30, "#9fb3a3", 21, "paperLite") },
      { f: 0.3, svg: [180, 880].map((x, i) => `<g filter="url(#paper)"><rect x="${x}" y="460" width="${200 - i * 40}" height="44" fill="#c9cfd2"/><path d="M${x - 8} 460 Q${x + 100} 436 ${x + 208 - i * 40} 460Z" fill="#a9b3b8"/><rect x="${x + 10}" y="470" width="${180 - i * 40}" height="12" fill="#7f97a8"/></g>`).join("") +
        `<g filter="url(#paper)"><rect x="560" y="398" width="12" height="108" fill="#c9cfd2"/><rect x="550" y="384" width="32" height="18" rx="4" fill="#7f97a8"/></g>` + ridge(512, 10, "#7c9a7f", 5) },
      { f: 0.75, svg: spots(9, 14).map((x, i) => (i % 3 ? `<rect x="${f1(x)}" y="500" width="3" height="20" fill="#6b6257"/>` : maple(x, 522, .8))).join("") + `<rect x="0" y="507" width="${TW}" height="2" fill="#6b6257"/>` },
    ],
    fuji: () => [
      { f: 0, svg: fuji(FW * .6, 470, 430, 240) },
      { f: 0.04, svg: clouds(7, 5) },
      { f: 0.1, svg: ridge(458, 48, "#7f9d86", 13) },
      { f: 0.2, svg: water(470, 506, "#5f8db3", "#46749b", 3) },
      { f: 0.35, svg: ridge(500, 18, C.matsu, 17) },
      { f: 0.75, svg: trees(3, 9, 524, .5, 1.1) },
    ],
    tea: () => [
      { f: 0, svg: fuji(FW * .62, 452, 380, 210) },
      { f: 0.04, svg: clouds(8, 4) },
      { f: 0.12, svg: ridge(450, 30, "#86a58b", 23) },
      { f: 0.4, svg: teaRows(446, 5, 3) },
      { f: 0.8, svg: spots(12, 6).map((x, i) => (i % 2 ? maple(x, 524, .9) : pine(x, 524, .8))).join("") },
    ],
    suruga: () => [
      { f: 0, svg: fuji(FW * .66, 420, 300, 170, "#5c7a9a") },
      { f: 0.04, svg: clouds(9, 4) },
      { f: 0.12, svg: water(420, 520, "#2f5a86", C.ai, 8) + spots(5, 3).map((x) => `<g transform="translate(${f1(x)} 450)" filter="url(#paperLite)"><path d="M-16 0 L16 0 L11 7 L-11 7Z" fill="${C.washi}"/><rect x="-2" y="-14" width="2" height="14" fill="${C.sumi}"/><path d="M0 -14 L12 -2 L0 -2Z" fill="${C.shu}"/></g>`).join("") },
      { f: 0.45, svg: `<rect x="0" y="496" width="${TW}" height="24" fill="#d9c79c" filter="url(#paperLite)"/>` },
      { f: 0.8, svg: spots(4, 12).map((x) => pine(x, 524, 1 + (x % 3) * .1)).join("") },
    ],
    izu: () => [
      { f: 0.03, svg: clouds(10, 4) },
      { f: 0.08, svg: water(400, 520, "#2f5a86", C.ai, 9) },
      { f: 0.3, svg: bigWave(260, 500, .9, 1) + bigWave(980, 505, .75, 2) },
      { f: 0.75, svg: [80, 760].map((x, i) => cliff(x, 522, 240 - i * 40, 190 - i * 30) + pine(x + 60, 522 - (150 - i * 25), .9) + pine(x + 130, 522 - (160 - i * 25), .75, "#35503f")).join("") },
    ],
    bamboo: () => [
      { f: 0.06, svg: ridge(420, 60, "#52705c", 31) },
      { f: 0.3, svg: spots(14, 40).map((x) => bamboo(x, 522, 260 + (x % 7) * 20, "#7fa36a")).join("") },
      { f: 0.8, svg: spots(15, 16).map((x) => bamboo(x, 530, 420, "#4f7a46")).join("") },
    ],
    kamakura: () => [
      { f: 0.03, svg: clouds(12, 4) },
      { f: 0.08, svg: water(440, 520, "#3d6a92", "#2a527a", 6) + `<path d="M900 446 Q930 404 980 412 Q1010 400 1040 446Z" fill="#4d6b58" filter="url(#paper)"/>` },
      { f: 0.3, svg: ridge(500, 16, "#6b8a72", 41) + templeRoof(400, 504, 1) + templeRoof(1100, 506, .8) },
      { f: 0.75, svg: trees(21, 10, 524, .65, 1.05) },
    ],
    tokyo: () => [
      { f: 0.04, svg: buildings(500, 61, { tall: 230, palette: ["#a9b7c6", "#b8c4d0", "#9cabbc"], lights: .22, lightC: "#d6dee6" }) + tower(700, 500, 1.1) },
      { f: 0.2, svg: buildings(512, 62, { tall: 150, palette: ["#7f93a8", "#8ea0b3", "#6f8399"], lights: .3, lightC: "#b9c7d4" }) },
      { f: 0.75, svg: spots(16, 10).map((x, i) => (i % 2 ? `<rect x="${f1(x)}" y="440" width="4" height="82" fill="#3a3f4f"/><rect x="${f1(x - 8)}" y="436" width="20" height="6" rx="3" fill="#3a3f4f"/>` : maple(x, 524, .85, C.kin))).join("") },
    ],
    tokyoNight: () => [
      { f: 0.04, svg: buildings(500, 71, { night: true, tall: 230, palette: ["#18273d", "#22344f"], lights: .3 }) + tower(700, 500, 1.1) },
      { f: 0.2, svg: buildings(512, 72, { night: true, tall: 150, palette: ["#121c2d", "#1a2740"], lights: .38, neon: [[80, 400, "渋谷", "#ff5fa2"], [520, 420, "ラーメン", "#4fe3e8"], [980, 410, "TOKYO", C.kin]] }) },
      { f: 0.75, svg: spots(17, 10).map((x) => `<rect x="${f1(x)}" y="440" width="4" height="82" fill="#0e1422"/><circle cx="${f1(x + 2)}" cy="438" r="9" fill="${C.kin}" opacity=".35" filter="url(#glow)"/><circle cx="${f1(x + 2)}" cy="438" r="3.4" fill="#ffe8b0"/>`).join("") },
    ],
  };
  const layerSVG = (l) => doc(l.f === 0 ? FW : TW, l.svg);

  /* ---------------- vehicles & props (world units, origin = road contact) ---------------- */
  const wheel = (x, y, r = 10.5) => `<g class="wheel" style="transform-origin:${x}px ${y}px"><circle cx="${x}" cy="${y}" r="${r}" fill="${C.sumi}"/><circle cx="${x}" cy="${y}" r="${r * .45}" fill="#c9c2b4"/><path d="M${x - r * .45} ${y} H${x + r * .45}" stroke="${C.sumi}" stroke-width="1.6"/></g>`;
  const heads = (xs, y) => xs.map((px, i) =>
    `<g class="p p${i}"><circle cx="${px}" cy="${y}" r="5.2" fill="${C.sumi}"/><path d="M${px - 7} ${y + 12} Q${px} ${y + 3} ${px + 7} ${y + 12}Z" fill="${C.sumi}"/>` +
    `<path class="arm" d="M${px + 5} ${y + 4} L${px + 10} ${y - 9}" stroke="${C.sumi}" stroke-width="3" stroke-linecap="round" style="transform-origin:${px + 5}px ${y + 4}px"/></g>`).join("");
  // Shiro: tall kei box car (N-BOX / Tanto style), facing right.
  function shiro(people = 4) {
    const xs = [22, 54, 70, 90].slice(0, people);
    return `<svg class="veh car" viewBox="-40 -100 280 112" width="280" height="112" style="margin:-100px 0 0 -40px">` +
      `<path class="beam" d="M118 -34 L200 -50 L200 -10 L118 -22Z" fill="${C.kin}" opacity=".22" filter="url(#glow)"/>` +
      `<g class="hz"><circle cx="115" cy="-26" r="7" fill="#ffb02e" filter="url(#glow)"/><circle cx="-1" cy="-26" r="7" fill="#ffb02e" filter="url(#glow)"/></g>` +
      `<g class="bodyg"><g filter="url(#paperCar)" fill="#FBF8F1" stroke="${C.sumi}" stroke-width="2.2"><path d="M0 -12 L0 -78 Q0 -86 8 -86 L96 -86 Q104 -86 106 -78 L114 -46 Q118 -44 118 -36 L118 -12 Q118 -6 112 -6 L6 -6 Q0 -6 0 -12Z"/></g>` +
      `<g fill="#9cc3d8" stroke="${C.sumi}" stroke-width="1.6"><path d="M8 -78 H38 V-50 H8Z M43 -78 H74 V-50 H43Z M79 -78 H98 L106 -50 H79Z"/></g>${heads(xs, -66)}` +
      `<rect x="0" y="-30" width="118" height="5" fill="${C.shu}"/><circle class="hl" cx="111" cy="-36" r="4.4" fill="${C.kin}"/>` +
      `<path d="M42 -48 V-10 M77 -48 V-10" stroke="${C.sumi}" stroke-opacity=".35" stroke-width="1.4"/><rect x="56" y="-40" width="10" height="2.6" rx="1.3" fill="${C.sumi}" opacity=".5"/>` +
      `</g>` +
      `${wheel(24, -6)}${wheel(94, -6)}<g class="dust" fill="${C.washi}"><circle cx="-10" cy="-8" r="5"/><circle cx="-20" cy="-12" r="3.6"/><circle cx="-28" cy="-6" r="2.6"/></g></svg>`;
  }
  function train() {
    let cars = "";
    for (let i = 0; i < 3; i++) {
      const cx = i * 128; let w = "";
      for (let k = 0; k < 4; k++) w += `<rect x="${cx + 12 + k * 28}" y="-50" width="20" height="18" rx="2" fill="#f6e3b0"/>`;
      cars += `<rect x="${cx}" y="-62" width="124" height="54" rx="7" fill="#d9dcd6" stroke="${C.sumi}" stroke-width="2"/>${w}<rect x="${cx}" y="-28" width="124" height="7" fill="#7cb342"/>`;
      if (i === 2) cars += heads([cx + 22, cx + 50, cx + 78, cx + 106], -46);
      cars += `<rect x="${cx + 14}" y="-8" width="26" height="6" rx="3" fill="${C.sumi}"/><rect x="${cx + 84}" y="-8" width="26" height="6" rx="3" fill="${C.sumi}"/>`;
    }
    return `<svg class="veh train" viewBox="-4 -66 420 68" width="420" height="68" style="margin:-66px 0 0 -4px">${cars}` +
      `<path d="M384 -62 Q404 -62 410 -40 L410 -14 Q410 -8 404 -8 L384 -8Z" fill="#d9dcd6" stroke="${C.sumi}" stroke-width="2"/><circle class="hl" cx="402" cy="-20" r="3.6" fill="${C.kin}"/></svg>`;
  }
  function bus() {
    let w = ""; for (let k = 0; k < 6; k++) w += `<rect x="${14 + k * 30}" y="-70" width="24" height="22" rx="2" fill="#9cc3d8" stroke="${C.sumi}" stroke-width="1.4"/>`;
    return `<svg class="veh bus" viewBox="-40 -96 290 108" width="290" height="108" style="margin:-96px 0 0 -40px">` +
      `<path class="beam" d="M206 -32 L250 -46 L250 -4 L206 -20Z" fill="${C.kin}" opacity=".22" filter="url(#glow)"/>` +
      `<g class="bodyg"><g filter="url(#paperCar)"><rect x="0" y="-84" width="210" height="76" rx="9" fill="#FBF8F1" stroke="${C.sumi}" stroke-width="2.2"/></g>${w}` +
      `<rect x="0" y="-40" width="210" height="9" fill="${C.momiji}"/><rect x="0" y="-30" width="210" height="4" fill="${C.shu}"/><text x="60" y="-15" font-family="'Noto Sans JP',sans-serif" font-weight="900" font-size="10" fill="${C.sumi}" letter-spacing="1">LIMOUSINE</text>` +
      `${heads([30, 60, 90, 120], -64)}<circle class="hl" cx="204" cy="-26" r="4.4" fill="${C.kin}"/></g>${wheel(40, -6, 12)}${wheel(170, -6, 12)}</svg>`;
  }
  // Walking figures with suitcases; n of them, facing right.
  function walkers(n) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const px = i * 24, h = i % 2 ? 0 : 3;
      s += `<g class="walker w${i}"><circle cx="${px}" cy="${-44 - h}" r="6" fill="${C.sumi}"/><path d="M${px - 7} -16 L${px - 6} ${-34 - h} Q${px} ${-38 - h} ${px + 6} ${-34 - h} L${px + 7} -16Z" fill="${C.sumi}"/>` +
        `<path class="legs" d="M${px - 3} -17 L${px - 6} 0M${px + 3} -17 L${px + 6} 0" stroke="${C.sumi}" stroke-width="3.4" stroke-linecap="round"/>` +
        `<path class="arm" d="M${px + 5} ${-32 - h} L${px + 12} ${-50 - h}" stroke="${C.sumi}" stroke-width="3" stroke-linecap="round" style="transform-origin:${px + 5}px ${-32 - h}px"/>` +
        `<rect x="${px - 18}" y="-20" width="9" height="13" rx="1.5" fill="${[C.shu, C.ai, C.momiji, C.matsu][i % 4]}"/><path d="M${px - 14} -20 v-4 h2" stroke="${C.sumi}" stroke-width="1.4" fill="none"/></g>`;
    }
    return `<svg class="walkers" viewBox="-24 -60 ${n * 24 + 30} 62" width="${n * 24 + 30}" height="62" style="margin:-60px 0 0 -24px">${s}</svg>`;
  }
  const PROPS = {
    ropeway: () => `<svg viewBox="-80 -330 240 334" width="240" height="334" style="margin:-330px 0 0 -80px"><g filter="url(#paper)">` +
      `<path d="M-80 -300 L160 -150" stroke="${C.sumi}" stroke-width="2"/><path d="M-6 0 L0 -250 L6 0Z" fill="#6b6257"/><rect x="-14" y="-254" width="28" height="6" fill="#6b6257"/>` +
      `<g transform="translate(66 -214)"><path d="M0 0 V16" stroke="${C.sumi}" stroke-width="2"/><rect x="-16" y="16" width="32" height="26" rx="5" fill="${C.shu}" stroke="${C.sumi}" stroke-width="1.6"/><rect x="-11" y="21" width="22" height="9" fill="#9cc3d8"/></g></g></svg>`,
    pagoda: () => { let g = ""; for (let i = 0; i < 5; i++) { const w = 34 - i * 5, yy = -i * 20; g += `<rect x="${-w / 2 + 5}" y="${yy - 16}" width="${w - 10}" height="16" fill="${C.shu}"/><path d="M${-w / 2 - 6} ${yy - 14} Q0 ${yy - 22} ${w / 2 + 6} ${yy - 14} L${w / 2} ${yy - 19} Q0 ${yy - 25} ${-w / 2} ${yy - 19}Z" fill="${C.sumi}"/>`; }
      return `<svg viewBox="-40 -230 80 232" width="80" height="232" style="margin:-230px 0 0 -40px"><g transform="scale(1.8)" filter="url(#paper)"><rect x="-1" y="-118" width="2" height="18" fill="${C.sumi}"/>${g}</g></svg>`; },
    torii: () => `<svg viewBox="-70 -140 140 142" width="140" height="142" style="margin:-140px 0 0 -70px"><g transform="scale(2.6)" filter="url(#paper)"><rect x="-22" y="-44" width="5" height="44" fill="${C.shu}"/><rect x="17" y="-44" width="5" height="44" fill="${C.shu}"/>` +
      `<rect x="-26" y="-36" width="52" height="4" fill="${C.shu}"/><path d="M-32 -48 Q0 -44 32 -48 L30 -42 Q0 -39 -30 -42Z" fill="${C.sumi}"/><rect x="-2" y="-42" width="4" height="7" fill="${C.shu}"/></g></svg>`,
    daibutsu: () => `<svg viewBox="-110 -250 220 252" width="220" height="252" style="margin:-250px 0 0 -110px"><g transform="scale(2.1)" filter="url(#paper)" fill="#5E7A6E"><path d="M-48 0 Q-50 -40 -30 -56 Q-16 -64 0 -64 Q16 -64 30 -56 Q50 -40 48 0Z"/>` +
      `<ellipse cx="0" cy="-80" rx="17" ry="20"/><circle cx="0" cy="-100" r="9"/><ellipse cx="0" cy="-10" rx="26" ry="9" fill="#4d665b"/></g></svg>`,
    lantern: () => `<svg viewBox="-90 -210 180 212" width="180" height="212" style="margin:-210px 0 0 -90px"><g filter="url(#paper)"><rect x="-80" y="-150" width="12" height="150" fill="${C.shu}"/><rect x="68" y="-150" width="12" height="150" fill="${C.shu}"/>` +
      `<path d="M-96 -168 Q0 -186 96 -168 L86 -150 L-86 -150Z" fill="#3d3a3a"/><rect x="-80" y="-150" width="160" height="10" fill="${C.shu}"/>` +
      `<rect x="-30" y="-138" width="60" height="78" rx="26" fill="#d9352b" stroke="${C.sumi}" stroke-width="2"/><rect x="-24" y="-142" width="48" height="6" fill="${C.sumi}"/><rect x="-24" y="-62" width="48" height="6" fill="${C.sumi}"/>` +
      `<text x="0" y="-88" text-anchor="middle" font-family="'Shippori Mincho',serif" font-weight="800" font-size="26" fill="${C.sumi}">雷門</text></g></svg>`,
    shiro: () => shiro(0),
    rental: () => `<svg viewBox="-100 -120 200 122" width="200" height="122" style="margin:-120px 0 0 -100px"><g filter="url(#paper)"><rect x="-95" y="-100" width="190" height="100" fill="#e9e1cf"/><rect x="-95" y="-100" width="190" height="18" fill="${C.shu}"/>` +
      `<text x="0" y="-87" text-anchor="middle" font-family="'Noto Sans JP',sans-serif" font-weight="900" font-size="11" fill="${C.washi}">レンタカー返却 · CAR RETURN</text>` +
      `<rect x="-75" y="-68" width="50" height="68" fill="#9cc3d8"/><rect x="-5" y="-68" width="80" height="40" fill="#9cc3d8"/><rect x="-75" y="-34" width="50" height="2" fill="${C.sumi}" opacity=".3"/></g></svg>`,
  };
  const avatar = (radio) => radio
    ? `<svg viewBox="0 0 60 60"><rect x="12" y="22" width="36" height="24" rx="5" fill="${C.washi}" stroke="${C.sumi}" stroke-width="2.4"/><circle cx="23" cy="34" r="6" fill="${C.sumi}"/><rect x="33" y="29" width="10" height="3" fill="${C.sumi}"/><rect x="33" y="35" width="10" height="3" fill="${C.sumi}"/><path d="M18 22 L40 10" stroke="${C.sumi}" stroke-width="2.4" stroke-linecap="round"/></svg>`
    : `<svg viewBox="0 0 60 60"><rect x="8" y="14" width="44" height="40" rx="7" fill="#FBF8F1" stroke="${C.sumi}" stroke-width="2.4"/><rect x="13" y="18" width="34" height="16" rx="3" fill="#9cc3d8" stroke="${C.sumi}" stroke-width="2"/>` +
      `<circle cx="18" cy="42" r="5" fill="${C.kin}" stroke="${C.sumi}" stroke-width="1.8"/><circle cx="42" cy="42" r="5" fill="${C.kin}" stroke="${C.sumi}" stroke-width="1.8"/><path d="M25 46 Q30 50 35 46" stroke="${C.sumi}" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="8" y="35" width="44" height="2.6" fill="${C.shu}"/></svg>`;

  // Static poster for the start gate.
  function poster(w = 360) {
    const cx = w / 2;
    return `<svg viewBox="0 0 ${w} ${H}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">${DEFS}` +
      `<defs><linearGradient id="gsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6e7c8"/><stop offset=".55" stop-color="#f3d9b0"/><stop offset="1" stop-color="#e9c79a"/></linearGradient></defs>` +
      `<rect width="${w}" height="${H}" fill="url(#gsky)"/><circle cx="${cx + 112}" cy="262" r="22" fill="${C.shu}"/>${cloud(cx - 166, 250, 1)}${cloud(cx + 50, 300, .7)}` +
      `${fuji(cx, 480, 380, 200, "#4F6D8F", "#FBF7EE", "gfj")}${ridge(470, 30, "#6d8a76", 3, "paper", w)}${ridge(505, 18, C.matsu, 8, "paper", w)}` +
      `<rect x="0" y="${RY}" width="${w}" height="42" fill="#3b3632"/><rect x="0" y="${RY}" width="${w}" height="4" fill="#d8cbb0"/><rect x="0" y="${RY + 42}" width="${w}" height="${H - RY - 42}" fill="#b49b72"/>` +
      `${pine(cx + 150, 522, 1.1)}${maple(cx - 150, 524, 1.05)}<g transform="translate(${cx - 100} 456)">${shiro(4)}</g></svg>`;
  }

  const LEAF = "M0 5 L-2 6 L-9 3 L-7 1 L-11 -4 L-6 -4 L-7 -10 L-2.5 -6.5 L0 -12 L2.5 -6.5 L7 -10 L6 -4 L11 -4 L7 1 L9 3 L2 6Z";

  window.ART = { C, H, RY, TW, FW, BIOMES, layerSVG, road: () => doc(TW, road()), rail: () => doc(TW, rail()), shiro, train, bus, walkers, PROPS, avatar, poster, LEAF };
})();
