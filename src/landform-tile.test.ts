import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { LocalDemManager } from "./local-dem-manager";
import type { DemTile } from "./types";
import { decodeLandformOptions, encodeLandformOptions } from "./utils";

const Z = 17;
const X = 65536;
const Y = 41000;
const SIZE = 256;

/** knolls in world pixel coordinates: one in the middle of tile X, one straddling the edge with tile X + 1 */
const KNOLLS = [
  [X * SIZE + 128, Y * SIZE + 128],
  [(X + 1) * SIZE, Y * SIZE + 60],
];
const cliffRow = Y * SIZE + 200;

function terrain(gx: number, gy: number): number {
  let h = 300;
  for (const [kx, ky] of KNOLLS) {
    h += 2.5 * Math.exp(-((gx - kx) ** 2 + (gy - ky) ** 2) / (2 * 3 * 3));
  }
  // a 4m step down to the south, a bit under the middle of the tile
  const t = Math.min(1, Math.max(0, (gy - cliffRow) / 2));
  return h - 4 * t;
}

const urls = new WeakMap<Blob, string>();
function manager() {
  return new LocalDemManager({
    demUrlPattern: "dem://{z}/{x}/{y}",
    cacheSize: 100,
    encoding: "terrarium",
    maxzoom: Z,
    timeoutMs: 10_000,
    getTile: async (url) => {
      const data = new Blob([url]);
      urls.set(data, url);
      return { data };
    },
    decodeImage: async (blob): Promise<DemTile> => {
      const [, x, y] = (urls.get(blob) as string)
        .split("//")[1]
        .split("/")
        .map(Number);
      const data = new Float32Array(SIZE * SIZE);
      for (let py = 0; py < SIZE; py++) {
        for (let px = 0; px < SIZE; px++) {
          data[py * SIZE + px] = terrain(x * SIZE + px, y * SIZE + py);
        }
      }
      return { width: SIZE, height: SIZE, data };
    },
  });
}

async function fetchTile(m: LocalDemManager, x: number, options = {}) {
  const { arrayBuffer } = await m.fetchLandformTile(
    Z,
    x,
    Y,
    options,
    new AbortController(),
  );
  const tile = new VectorTile(new Pbf(arrayBuffer));
  const read = (name: string) => {
    const layer = tile.layers[name];
    const features = [];
    for (let i = 0; layer && i < layer.length; i++) {
      const feature = layer.feature(i);
      features.push({
        properties: feature.properties,
        geometry: feature.loadGeometry(),
      });
    }
    return features;
  };
  return {
    points: read("landform_points"),
    lines: read("landform_lines"),
    ticks: read("landform_ticks"),
    areas: read("landform_areas"),
  };
}

test("landform tile contains knolls and a cliff edge with tags", async () => {
  const m = manager();
  const tile = await fetchTile(m, X, {
    features: ["knolls", "banks"],
  });
  expect(tile.points).toHaveLength(1);
  expect(tile.points[0].properties).toMatchObject({ kind: "knoll", isom: 109 });
  const [[point]] = tile.points[0].geometry;
  expect(point.x).toBeGreaterThan(1900);
  expect(point.x).toBeLessThan(2200);
  expect(tile.lines.length).toBeGreaterThan(0);
  expect(tile.lines[0].properties).toMatchObject({ height: expect.anything() });
  expect(tile.ticks.length).toBeGreaterThan(10);
});

test("tag spacing changes the tags and nothing else", async () => {
  const m = manager();
  const sparse = await fetchTile(m, X, {
    features: ["banks"],
    tickSpacing: 160,
  });
  const dense = await fetchTile(m, X, { features: ["banks"], tickSpacing: 40 });
  const long = await fetchTile(m, X, { features: ["banks"], tickLength: 100 });
  expect(sparse.lines).toEqual(dense.lines);
  expect(dense.ticks.length).toBeGreaterThan(sparse.ticks.length * 3);
  const length = (t: (typeof long.ticks)[number]) => {
    const [a, b] = t.geometry[0];
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  expect(length(long.ticks[0])).toBeGreaterThan(length(sparse.ticks[0]) * 2);
  // the DEM is fetched once however many times the tags are redone
  expect(m.landformDetectionCache.size()).toBe(1);
});

test("a knoll on a tile edge is owned by exactly one tile", async () => {
  const m = manager();
  const options = { features: ["knolls" as const] };
  const west = await fetchTile(m, X, options);
  const east = await fetchTile(m, X + 1, options);
  expect(west.points.length + east.points.length).toBe(2);
});

test("coarse DEMs produce empty tiles", async () => {
  const m = manager();
  const { arrayBuffer } = await m.fetchLandformTile(
    4,
    8,
    5,
    {},
    new AbortController(),
  );
  expect(arrayBuffer.byteLength).toBe(0);
});

test("options survive the round trip through a url", () => {
  const options = {
    features: ["knolls" as const, "banks" as const],
    thresholds: { steepSlope: 35, knollMinHeight: 0.5 },
    tickSpacing: 60,
  };
  const url = `dem-landform://1/2/3?${encodeLandformOptions(options)}`;
  expect(decodeLandformOptions(url)).toEqual(options);
  expect(decodeLandformOptions("dem-landform://1/2/3")).toEqual({});
  expect(encodeLandformOptions({ tickSpacing: 1, extent: 2 })).toEqual(
    encodeLandformOptions({ extent: 2, tickSpacing: 1 }),
  );
});
