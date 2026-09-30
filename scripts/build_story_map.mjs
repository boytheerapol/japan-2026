// Build the coastline for the story map (site/story/map.json). Mercator, same math as story.js.
// One-off: only needed if you want a different map area or detail level.
//   npm i --no-save world-atlas@2 topojson-client d3-geo && node scripts/build_story_map.mjs
// After changing it, rebuild the driving lines: node scripts/build_story_routes.mjs
import fs from "fs";
import * as topo from "topojson-client";
import * as d3 from "d3-geo";
const S = 21220, LNG0 = 137.9, LAT0 = 36.0;             // top-left anchor of the trip region
const proj = d3.geoMercator().scale(S).translate([0, 0]);
const [ox, oy] = proj([LNG0, LAT0]);
proj.translate([-ox, -oy]);
const land10 = topo.feature(...(t => [t, t.objects.land])(JSON.parse(fs.readFileSync("node_modules/world-atlas/land-10m.json"))));
const land50 = topo.feature(...(t => [t, t.objects.land])(JSON.parse(fs.readFileSync("node_modules/world-atlas/land-50m.json"))));
const round = (d) => d.replace(/(\d+\.\d)\d+/g, "$1");
// d3 emits the whole clip rectangle as an extra ring for polygons that wrap the globe (e.g. Antarctica); drop it
const dropRect = (d) => d.split("M").filter((r) => r && (r.match(/L/g) || []).length > 3).map((r) => "M" + r).join("");
// region detail: clip to trip bbox (with margin)
const [x0, y0] = proj([137.2, 36.8]), [x1, y1] = proj([141.2, 33.8]);
const pRegion = d3.geoPath(d3.geoMercator().scale(S).translate([-ox, -oy]).clipExtent([[x0, y0], [x1, y1]]));
// whole Japan (coarse) for the zoom-in opener
const [jx0, jy0] = proj([127, 46]), [jx1, jy1] = proj([147, 30]);
const pJapan = d3.geoPath(d3.geoMercator().scale(S).translate([-ox, -oy]).clipExtent([[jx0, jy0], [jx1, jy1]]));
const region = dropRect(round(pRegion(land10) || "")), japan = dropRect(round(pJapan(land50) || ""));
const out = { S, LNG0, LAT0, region, japan, japanBox: [jx0, jy0, jx1 - jx0, jy1 - jy0] };
fs.writeFileSync(new URL("../site/story/map.json", import.meta.url), JSON.stringify(out));
console.log("region", region.length, "japan", japan.length);
