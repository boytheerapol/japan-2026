// Build over-land driving routes for the story map (site/story/routes.json).
//
// The story map is illustrative, so instead of calling a routing service we
// rasterise the coastline in site/story/map.json and let A* find a path over
// land between consecutive stops, then smooth it so it reads like a road.
// Run it again whenever coordinates in site/story/script.json change:
//
//     node scripts/build_story_routes.mjs
//
// No npm packages needed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORY = path.join(ROOT, "site", "story");
const MAP = JSON.parse(fs.readFileSync(path.join(STORY, "map.json"), "utf8"));
const SCRIPT = JSON.parse(fs.readFileSync(path.join(STORY, "script.json"), "utf8"));

const STEP = 2;            // grid cell size in map units (~0.5 km)
const COAST_BUFFER = 3;    // cells; routes are nudged this far inland when possible

// --- projection (same as story.js) ------------------------------------
const R = Math.PI / 180;
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * R) / 2));
const proj = (lat, lng) => [MAP.S * (lng - MAP.LNG0) * R, MAP.S * (merc(MAP.LAT0) - merc(lat))];

// --- rasterise land ---------------------------------------------------
const rings = MAP.region.split("M").filter(Boolean).map((r) =>
  [...r.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [+m[1], +m[2]]));
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const ring of rings) for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
const W = Math.ceil((maxX - minX) / STEP) + 1, H = Math.ceil((maxY - minY) / STEP) + 1;
const land = new Uint8Array(W * H);
for (let row = 0; row < H; row++) {                 // even-odd scanline fill
  const y = minY + (row + 0.5) * STEP, xs = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[j];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
  }
  xs.sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const c0 = Math.max(0, Math.ceil((xs[k] - minX) / STEP - 0.5)), c1 = Math.min(W - 1, Math.floor((xs[k + 1] - minX) / STEP - 0.5));
    for (let c = c0; c <= c1; c++) land[row * W + c] = 1;
  }
}

// distance to the sea (in cells, capped) so paths prefer to stay a little inland
const dist = new Uint8Array(W * H).fill(255);
let frontier = [];
for (let i = 0; i < W * H; i++) if (!land[i]) { dist[i] = 0; frontier.push(i); }
for (let d = 1; d <= COAST_BUFFER; d++) {
  const next = [];
  for (const i of frontier) {
    const r = (i / W) | 0, c = i % W;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      const k = rr * W + cc;
      if (dist[k] === 255) { dist[k] = d; next.push(k); }
    }
  }
  frontier = next;
}

const cellOf = ([x, y]) => [Math.min(H - 1, Math.max(0, Math.round((y - minY) / STEP - 0.5))), Math.min(W - 1, Math.max(0, Math.round((x - minX) / STEP - 0.5)))];
const centerOf = (r, c) => [minX + (c + 0.5) * STEP, minY + (r + 0.5) * STEP];

function nearestLand(r, c) {                         // coastal spots can fall just offshore in coarse data
  if (land[r * W + c]) return [r, c];
  for (let rad = 1; rad < 40; rad++) {
    let best = null, bd = Infinity;
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= H || cc >= W || !land[rr * W + cc]) continue;
      const d = dr * dr + dc * dc;
      if (d < bd) { bd = d; best = [rr, cc]; }
    }
    if (best) return best;
  }
  return [r, c];
}

// --- A* ---------------------------------------------------------------
class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
function astar(a, b) {
  const [sr, sc] = nearestLand(...cellOf(a)), [er, ec] = nearestLand(...cellOf(b));
  const start = sr * W + sc, goal = er * W + ec;
  if (start === goal) return [a, b];
  const g = new Float64Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
  const h = (i) => Math.hypot(((i / W) | 0) - er, (i % W) - ec);
  const open = new Heap();
  g[start] = 0; open.push({ i: start, f: h(start) });
  while (open.size) {
    const { i } = open.pop();
    if (done[i]) continue;          // stale heap entry
    done[i] = 1;
    if (i === goal) break;
    const r = (i / W) | 0, c = i % W;
    for (const [dr, dc, cost] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      const k = rr * W + cc;
      if (!land[k] || done[k]) continue;
      const coast = dist[k] < COAST_BUFFER ? (COAST_BUFFER - dist[k]) * 0.35 : 0;
      const ng = g[i] + cost * (1 + coast);
      if (ng < g[k]) { g[k] = ng; from[k] = i; open.push({ i: k, f: ng + h(k) }); }
    }
  }
  if (from[goal] === -1) { console.warn("  no land path, using a straight line"); return [a, b]; }
  const cells = [];
  for (let i = goal; i !== -1; i = from[i]) cells.push(i);
  cells.reverse();
  return [a, ...cells.map((i) => centerOf((i / W) | 0, i % W)), b];
}

// --- smoothing --------------------------------------------------------
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, by - ay) || 1;
  let idx = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  return dmax > eps ? [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)] : [pts[0], pts[pts.length - 1]];
}
function chaikin(pts, n = 2) {
  for (let k = 0; k < n; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}
const round = (pts) => pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
const leg = (a, b) => round(chaikin(rdp(astar(a, b), 1.4)));

// --- stops per day (same order as story.js buildTimeline) --------------
const N = SCRIPT.nights;
const at = (o) => proj(o.lat ?? o[0], o.lng ?? o[1]);
const out = { _comment: "Generated by scripts/build_story_routes.mjs — do not edit by hand.", days: {} };
for (const d of SCRIPT.days) {
  const stops = [N[d.n - 1], ...d.spots];
  if (d.split) stops.push(N[d.n]);
  stops.push(...(d.spotsAfter || []));
  if (!d.split) stops.push(N[d.n]);
  const pts = stops.map(at);
  const legs = [];
  for (let i = 1; i < pts.length; i++) legs.push(leg(pts[i - 1], pts[i]));
  out.days[d.n] = { legs };
  if (d.split) out.days[d.n].car = leg(proj(N[d.n][0], N[d.n][1]), proj(N["0"][0], N["0"][1]));
  console.log(`Day ${d.n}: ${legs.length} legs, ${legs.reduce((a, l) => a + l.length, 0)} points`);
}
fs.writeFileSync(path.join(STORY, "routes.json"), JSON.stringify(out));
console.log(`wrote site/story/routes.json (${(fs.statSync(path.join(STORY, "routes.json")).size / 1024).toFixed(1)} KB), grid ${W}×${H}`);
