import { HeightTile } from "./height-tile";
import { Grid } from "./landform-grid";
import { resolveLandformOptions } from "./landform-options";
import type { LandformGroup, LandformThresholds } from "./landform-options";
import { clipPolyline } from "./landform-ops";
import { detectLandforms } from "./landforms";

const TILE = 128;
const MARGIN = 40;
/** tile units per pixel */
const S = 4096 / TILE;

function run(
  fn: (x: number, y: number) => number,
  features: LandformGroup[],
  thresholds: Partial<LandformThresholds> = {},
) {
  const grid = Grid.fromFunction(TILE, TILE, MARGIN, 1, fn);
  const options = resolveLandformOptions({ features, thresholds });
  const corners = new HeightTile(TILE + 1, TILE + 1, (x, y) =>
    fn(x - 0.5, y - 0.5),
  );
  return detectLandforms(grid, options, corners);
}

const gauss = (
  x: number,
  y: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  amplitude: number,
) =>
  amplitude *
  Math.exp(-((x - cx) ** 2 / (2 * sx * sx) + (y - cy) ** 2 / (2 * sy * sy)));

/** tile coordinates of the centre of pixel index `p` */
const at = (p: number) => (p + 0.5) * S;

test("knoll", () => {
  const { points } = run(
    (x, y) => 0.01 * x + gauss(x, y, 64, 60, 2.5, 2.5, 2),
    ["knolls", "depressions"],
  );
  expect(points).toHaveLength(1);
  const [knoll] = points;
  expect(knoll.properties).toMatchObject({
    kind: "knoll",
    isom: 109,
    small: true,
    contoured: false,
  });
  expect(knoll.properties.height).toBeGreaterThan(1.5);
  expect(knoll.properties.height).toBeLessThan(2.5);
  expect(Math.abs(knoll.geometry[0][0] - at(64))).toBeLessThan(S);
  expect(Math.abs(knoll.geometry[0][1] - at(60))).toBeLessThan(S);
});

test("knoll lower than the minimum height is ignored", () => {
  const { points } = run(
    (x, y) => gauss(x, y, 64, 60, 2.5, 2.5, 0.7),
    ["knolls"],
  );
  expect(points).toHaveLength(0);
});

test("elongated knoll is oriented along its long axis", () => {
  const { points } = run((x, y) => gauss(x, y, 64, 60, 6, 2, 2), ["knolls"]);
  expect(points).toHaveLength(1);
  // long axis runs east-west
  expect(points[0].properties).toMatchObject({
    kind: "elongated_knoll",
    isom: 110,
    orient: 90,
  });
});

test("pits and depressions", () => {
  const { points } = run(
    (x, y) => {
      const pit = Math.hypot(x - 40, y - 60);
      const bowl = Math.hypot(x - 90, y - 60);
      return (
        -3 * Math.max(0, 1 - pit / 3) - 1.5 * Math.max(0, 1 - (bowl / 8) ** 2)
      );
    },
    ["depressions"],
  );
  const kinds = points.map((p) => p.properties.kind).sort();
  expect(kinds).toEqual(["depression", "pit"]);
  const pit = points.find((p) => p.properties.kind === "pit");
  expect(pit?.properties).toMatchObject({ isom: 112 });
  expect(pit?.properties.depth).toBeGreaterThan(2.5);
});

test("boulders are only found when asked for", () => {
  const terrain = (x: number, y: number) => gauss(x, y, 64, 60, 0.9, 0.9, 2.5);
  expect(run(terrain, ["knolls"]).points[0].properties.kind).toBe("knoll");
  const boulder = run(terrain, ["boulders"]).points;
  expect(boulder).toHaveLength(1);
  expect(boulder[0].properties).toMatchObject({
    kind: "large_boulder",
    isom: 205,
  });
});

test("erosion gully is a line along the bottom of the ditch", () => {
  const { lines } = run(
    (x, y) => 0.02 * x - gauss(x, y, 0, 64, 1e9, 1.5, 1.5),
    ["gullies"],
  );
  expect(lines).toHaveLength(1);
  expect(lines[0].properties).toMatchObject({
    kind: "erosion_gully",
    isom: 107,
  });
  for (let k = 1; k < lines[0].geometry[0].length; k += 2) {
    expect(Math.abs(lines[0].geometry[0][k] - at(64))).toBeLessThan(S);
  }
});

test("a shallow ditch is a small erosion gully", () => {
  const { lines } = run(
    (x, y) => 0.02 * x - gauss(x, y, 0, 64, 1e9, 1.5, 0.8),
    ["gullies"],
  );
  expect(lines.map((l) => l.properties.kind)).toEqual(["small_erosion_gully"]);
});

test("a broad valley is not a gully", () => {
  const { lines } = run(
    (x, y) => -gauss(x, y, 0, 64, 1e9, 14, 6),
    ["gullies", "walls"],
  );
  expect(lines).toHaveLength(0);
});

test("earth wall", () => {
  const { lines } = run(
    (x, y) => gauss(x, y, 0, 64, 1e9, 1.2, 1.4),
    ["walls", "gullies"],
  );
  expect(lines.map((l) => l.properties.kind)).toEqual(["earth_wall"]);
});

test("steep step becomes an edge on its top with tags pointing downhill", () => {
  // high ground to the north (small y), 3 m step down to the south
  const { lines, ticks } = run(
    (_, y) => (y < 60 ? 3 : y > 61.5 ? 0 : 3 * (1 - (y - 60) / 1.5)),
    ["banks"],
  );
  expect(lines).toHaveLength(1);
  expect(["bank", "cliff", "impassable_cliff"]).toContain(
    lines[0].properties.kind,
  );
  expect(lines[0].properties.height).toBeGreaterThan(2);
  for (let k = 1; k < lines[0].geometry[0].length; k += 2) {
    expect(Math.abs(lines[0].geometry[0][k] - at(60))).toBeLessThan(2 * S);
  }
  expect(ticks.length).toBeGreaterThan(20);
  for (const tick of ticks) {
    const [x0, y0, x1, y1] = tick.geometry[0];
    expect(y1).toBeGreaterThan(y0 + 20);
    expect(Math.abs(x1 - x0)).toBeLessThan(2);
  }
});

test("the same step seen from the other side has the same tags", () => {
  const { ticks } = run(
    (_, y) => (y > 60 ? 3 : y < 58.5 ? 0 : 3 * (1 - (60 - y) / 1.5)),
    ["banks"],
  );
  expect(ticks.length).toBeGreaterThan(20);
  for (const tick of ticks) {
    const [, y0, , y1] = tick.geometry[0];
    expect(y1).toBeLessThan(y0 - 20);
  }
});

test("steps on a steep hillside are not banks, but a cliff on it is", () => {
  // a hillside that falls to the south at 35 degrees with a 1.8 m, 58 degree step every 8 m,
  // which is 43 degrees on average
  const terraces = (_: number, y: number) => {
    const k = Math.floor(y / 8);
    const f = Math.min(1, (y - 8 * k) / 2);
    return -0.7 * y - 1.8 * (k + f);
  };
  // with the contrast against the hillside switched off every riser is a bank
  expect(
    run(terraces, ["banks"], { bankSlopeExcess: 0 }).lines.length,
  ).toBeGreaterThan(3);
  expect(run(terraces, ["banks"]).lines).toHaveLength(0);

  // a real 5 m cliff in the same hillside is still found, and only that
  const withCliff = (x: number, y: number) =>
    terraces(x, y) + (y < 64 ? 5 : y > 65 ? 0 : 5 * (65 - y));
  const { lines } = run(withCliff, ["banks"]);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    for (let k = 1; k < line.geometry[0].length; k += 2) {
      expect(Math.abs(line.geometry[0][k] - at(64))).toBeLessThan(3 * S);
    }
  }
});

test("a gentle slope has no edges", () => {
  expect(run((x, y) => 0.3 * x + 0.2 * y, ["banks"]).lines).toHaveLength(0);
});

test("broken ground is an area around the hummocks only", () => {
  const { areas } = run(
    (x, y) =>
      x > 30 && x < 100 && y > 30 && y < 100
        ? 0.8 * Math.sin(x) * Math.sin(y)
        : 0,
    ["brokenGround"],
  );
  expect(areas.length).toBeGreaterThan(0);
  expect(areas[0].properties.kind).toBe("broken_ground");
  const ring = areas[0].geometry[0];
  // closed, and well inside the tile because the hummocks are
  expect(ring.slice(0, 2)).toEqual(ring.slice(-2));
  for (let k = 0; k < ring.length; k += 1) {
    expect(ring[k]).toBeGreaterThan(at(20));
    expect(ring[k]).toBeLessThan(at(110));
  }
  expect(run(() => 0, ["brokenGround"]).areas).toHaveLength(0);
});

test("form lines only in flat ground", () => {
  const flat = run((_, y) => 0.0175 * y + 1, ["formLines"]);
  expect(flat.lines).toHaveLength(1);
  expect(flat.lines[0].properties).toMatchObject({
    kind: "form_line",
    ele: 2.5,
  });
  // 0.5 slope has no half-interval contour that is flat enough
  expect(run((_, y) => 0.5 * y + 1, ["formLines"]).lines).toHaveLength(0);
});

test("flat terrain produces nothing", () => {
  const result = run(
    () => 100,
    ["knolls", "depressions", "banks", "gullies", "walls", "brokenGround"],
  );
  expect(result).toEqual({
    points: [],
    lines: [],
    ticks: [],
    tickLines: [],
    areas: [],
  });
});

test("clipPolyline interpolates at the rectangle edge", () => {
  expect(clipPolyline([-10, 5, 20, 5], 0, 0, 10, 10)).toEqual([[0, 5, 10, 5]]);
  expect(clipPolyline([-10, 20, 20, 20], 0, 0, 10, 10)).toEqual([]);
  expect(clipPolyline([5, 5, 5, 15, 6, 15, 6, 5], 0, 0, 10, 10)).toEqual([
    [5, 5, 5, 10],
    [6, 10, 6, 5],
  ]);
});
