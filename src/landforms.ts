import { HeightTile } from "./height-tile";
import generateIsolines from "./isolines";
import {
  Grid,
  bilinear,
  boxMean,
  computeGradient,
  type Gradient,
} from "./landform-grid";
import {
  clipPolyline,
  labelComponents,
  median,
  pathLength,
  percentile,
  pointInRing,
  priorityFlood,
  signedArea,
  simplifyPath,
  smoothPath,
  thin,
  traceSkeleton,
} from "./landform-ops";
import type {
  LandformThresholds,
  ResolvedLandformOptions,
} from "./landform-options";
import { GeomType } from "./vtpbf";
import type { Feature } from "./vtpbf";

/** Detected features, in vector tile coordinates, ready to be encoded into layers. */
export interface LandformResult {
  /** knolls, depressions, pits, boulders */
  points: Feature[];
  /** banks, cliffs, gullies, walls and form lines */
  lines: Feature[];
  /** downhill tags for banks and cliffs */
  ticks: Feature[];
  /** the lines the tags hang from, so that tags can be redone with other spacing without detecting again */
  tickLines: TickLine[];
  /** broken ground */
  areas: Feature[];
}

export interface TickLine {
  /** flat polyline in tile units, with downhill on its left */
  points: number[];
  properties: Feature["properties"];
}

/** Sub-pixel precision used when asking the marching squares code for lines. */
const SUBPIXEL = 64;
const RAD = Math.PI / 180;

const round1 = (v: number) => Math.round(v * 10) / 10;

interface Context {
  grid: Grid;
  grad: Gradient;
  t: LandformThresholds;
  o: ResolvedLandformOptions;
  extent: number;
  /** tile units per pixel */
  s: number;
  /** tile units that lines may extend beyond the tile edge */
  bufferUnits: number;
  /** window coordinate to tile coordinate */
  toX: (i: number) => number;
  toY: (j: number) => number;
}

/** Whether a contour line at a multiple of `interval` passes through the height range. */
function crossesContour(low: number, high: number, interval: number): boolean {
  return (
    interval > 0 && Math.floor(high / interval) > Math.floor(low / interval)
  );
}

/** Converts window pixel coordinates of a flat polyline to tile units. */
function toTileUnits(ctx: Context, points: number[]): number[] {
  const out = new Array<number>(points.length);
  for (let k = 0; k < points.length; k += 2) {
    out[k] = ctx.toX(points[k]);
    out[k + 1] = ctx.toY(points[k + 1]);
  }
  return out;
}

function roundPath(points: number[]): number[] {
  return points.map(Math.round);
}

function reverseRing(ring: number[]): number[] {
  const out: number[] = [];
  for (let k = ring.length - 2; k >= 0; k -= 2) out.push(ring[k], ring[k + 1]);
  return out;
}

function lineFeatures(
  ctx: Context,
  tilePoints: number[],
  properties: Feature["properties"],
  out: Feature[],
) {
  const b = ctx.bufferUnits;
  for (const piece of clipPolyline(
    tilePoints,
    -b,
    -b,
    ctx.extent + b,
    ctx.extent + b,
  )) {
    out.push({
      type: GeomType.LINESTRING,
      geometry: [roundPath(piece)],
      properties,
    });
  }
}

/**
 * Short tags, perpendicular to each line and on its left (the downhill side), spaced along it.
 * `spacing` and `length` are in tile units.
 */
export function makeTicks(
  lines: TickLine[],
  extent: number,
  spacing: number,
  length: number,
): Feature[] {
  const out: Feature[] = [];
  if (!(spacing > 0) || !(length > 0)) return out;
  for (const { points, properties } of lines) {
    let next = spacing / 2;
    let travelled = 0;
    for (let k = 2; k < points.length; k += 2) {
      const x0 = points[k - 2];
      const y0 = points[k - 1];
      const dx = points[k] - x0;
      const dy = points[k + 1] - y0;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      while (next <= travelled + len) {
        const f = (next - travelled) / len;
        const x = x0 + dx * f;
        const y = y0 + dy * f;
        if (x >= 0 && y >= 0 && x <= extent && y <= extent) {
          out.push({
            type: GeomType.LINESTRING,
            geometry: [
              roundPath([
                x,
                y,
                x + (dy / len) * length,
                y - (dx / len) * length,
              ]),
            ],
            properties,
          });
        }
        next += spacing;
      }
      travelled += len;
    }
  }
  return out;
}

interface Blob {
  /** centroid, window coordinates */
  cx: number;
  cy: number;
  cells: number;
  /** deepest/highest point relative to the spill level */
  maxDepth: number;
  /** window index of that point */
  arg: number;
  /** metres */
  length: number;
  width: number;
  /** bearing of the long axis, degrees clockwise from north, 0-180 */
  orient: number;
  /** 90th percentile slope on the blob, degrees */
  wallSlope: number;
}

/**
 * Labels the pixels where `depth >= labelDepth` and describes each blob whose deepest point
 * is at least `minDepth`, whose centroid lies in the tile, and that is not cut off by the window edge.
 */
function findBlobs(
  ctx: Context,
  depth: Float32Array,
  labelDepth: number,
  minDepth: number,
): Blob[] {
  const { grid, grad, t } = ctx;
  const { width: w, height: h, margin } = grid;
  const mask = new Uint8Array(w * h);
  for (let k = 0; k < mask.length; k++) {
    if (depth[k] >= labelDepth) mask[k] = 1;
  }
  const { labels, count } = labelComponents(mask, w, h);
  if (count === 0) return [];

  const n = new Float64Array(count + 1);
  const sx = new Float64Array(count + 1);
  const sy = new Float64Array(count + 1);
  const sxx = new Float64Array(count + 1);
  const syy = new Float64Array(count + 1);
  const sxy = new Float64Array(count + 1);
  const maxD = new Float32Array(count + 1).fill(-Infinity);
  const arg = new Int32Array(count + 1);
  const bad = new Uint8Array(count + 1);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const idx = j * w + i;
      const l = labels[idx];
      if (!l) continue;
      n[l]++;
      sx[l] += i;
      sy[l] += j;
      sxx[l] += i * i;
      syy[l] += j * j;
      sxy[l] += i * j;
      if (depth[idx] > maxD[l]) {
        maxD[l] = depth[idx];
        arg[l] = idx;
      }
      // touching the edge of the window or missing data means we can't trust the blob
      if (
        i <= 1 ||
        j <= 1 ||
        i >= w - 2 ||
        j >= h - 2 ||
        isNaN(grad.mag[idx])
      ) {
        bad[l] = 1;
      }
    }
  }

  const blobs = new Map<number, Blob>();
  for (let l = 1; l <= count; l++) {
    if (bad[l] || n[l] < t.minCells || maxD[l] < minDepth) continue;
    const cx = sx[l] / n[l];
    const cy = sy[l] / n[l];
    const px = cx - margin;
    const py = cy - margin;
    if (px < 0 || py < 0 || px >= grid.tileWidth || py >= grid.tileHeight) {
      continue;
    }
    // a pixel has a variance of 1/12, which keeps tiny blobs from collapsing to zero size
    const vxx = sxx[l] / n[l] - cx * cx + 1 / 12;
    const vyy = syy[l] / n[l] - cy * cy + 1 / 12;
    const vxy = sxy[l] / n[l] - cx * cy;
    const mean = (vxx + vyy) / 2;
    const spread = Math.sqrt(((vxx - vyy) / 2) ** 2 + vxy * vxy);
    const theta = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
    const bearing =
      (Math.atan2(Math.cos(theta), -Math.sin(theta)) / RAD + 180) % 180;
    blobs.set(l, {
      cx,
      cy,
      cells: n[l],
      maxDepth: maxD[l],
      arg: arg[l],
      length: 4 * Math.sqrt(mean + spread) * grid.cell,
      width: 4 * Math.sqrt(Math.max(mean - spread, 1 / 12)) * grid.cell,
      orient: bearing,
      wallSlope: 0,
    });
  }

  const slopes = new Map<number, number[]>();
  blobs.forEach((_, l) => slopes.set(l, []));
  for (let idx = 0; idx < labels.length; idx++) {
    const list = slopes.get(labels[idx]);
    if (list && !isNaN(grad.mag[idx])) list.push(grad.mag[idx]);
  }
  slopes.forEach((list, l) => {
    (blobs.get(l) as Blob).wallSlope = Math.atan(percentile(list, 0.9)) / RAD;
  });
  return [...blobs.values()];
}

function pointFeature(
  ctx: Context,
  cx: number,
  cy: number,
  properties: Feature["properties"],
): Feature {
  return {
    type: GeomType.POINT,
    geometry: [[Math.round(ctx.toX(cx)), Math.round(ctx.toY(cy))]],
    properties,
  };
}

/** Small knolls (109, 110), boulders (204, 205), small depressions (111) and pits (112). */
function detectBlobFeatures(ctx: Context, out: LandformResult) {
  const { grid, t, o } = ctx;
  const data = grid.data;
  const knolls = o.groups.has("knolls");
  const boulders = o.groups.has("boulders");

  if (knolls || boulders) {
    // a mound is a depression of the upside-down terrain: flood that to find how high it stands
    const inverted = data.map((v) => -v);
    const filled = priorityFlood(inverted, grid.width, grid.height);
    const height = filled.map((v, k) => v - inverted[k]);
    const minHeight = Math.min(
      knolls ? t.knollMinHeight : Infinity,
      boulders ? t.boulderMinHeight : Infinity,
    );
    for (const blob of findBlobs(ctx, height, minHeight * 0.5, minHeight)) {
      const top = data[blob.arg];
      const base = top - blob.maxDepth;
      const common = {
        ele: round1(top),
        height: round1(blob.maxDepth),
        length: round1(blob.length),
        width: round1(blob.width),
        contoured: crossesContour(base, top, t.contourInterval),
      };
      if (
        boulders &&
        blob.maxDepth >= t.boulderMinHeight &&
        blob.length <= t.boulderMaxLength &&
        // too small for a gradient to be measured, so use the average slope from the top to the edge
        Math.atan(blob.maxDepth / (blob.length / 2)) / RAD >=
          t.boulderMinWallSlope
      ) {
        const large = blob.maxDepth >= t.largeBoulderMinHeight;
        out.points.push(
          pointFeature(ctx, blob.cx, blob.cy, {
            ...common,
            kind: large ? "large_boulder" : "boulder",
            isom: large ? 205 : 204,
          }),
        );
        continue;
      }
      if (
        !knolls ||
        blob.maxDepth < t.knollMinHeight ||
        blob.length > t.knollMaxLength
      ) {
        continue;
      }
      const elongated = blob.length / blob.width >= t.elongationRatio;
      out.points.push(
        pointFeature(ctx, blob.cx, blob.cy, {
          ...common,
          kind: elongated ? "elongated_knoll" : "knoll",
          isom: elongated ? 110 : 109,
          orient: Math.round(blob.orient),
          small: !(
            blob.length >= t.contourKnollLength &&
            blob.width >= t.contourKnollWidth
          ),
        }),
      );
    }
  }

  if (o.groups.has("depressions")) {
    const filled = priorityFlood(data, grid.width, grid.height);
    const depth = filled.map((v, k) => v - data[k]);
    const minDepth = Math.min(t.pitMinDepth, t.depressionMinDepth);
    for (const blob of findBlobs(ctx, depth, minDepth * 0.5, minDepth)) {
      if (blob.length > t.depressionMaxLength) continue;
      const bottom = data[blob.arg];
      const common = {
        ele: round1(bottom),
        depth: round1(blob.maxDepth),
        length: round1(blob.length),
        width: round1(blob.width),
        contoured: crossesContour(
          bottom,
          bottom + blob.maxDepth,
          t.contourInterval,
        ),
      };
      if (
        blob.maxDepth >= t.pitMinDepth &&
        blob.width >= t.pitMinWidth &&
        blob.length <= t.pitMaxLength &&
        blob.wallSlope >= t.pitMinWallSlope
      ) {
        out.points.push(
          pointFeature(ctx, blob.cx, blob.cy, {
            ...common,
            kind: "pit",
            isom: 112,
            slope: Math.round(blob.wallSlope),
          }),
        );
      } else if (
        blob.maxDepth >= t.depressionMinDepth &&
        blob.width >= t.depressionMinWidth
      ) {
        out.points.push(
          pointFeature(ctx, blob.cx, blob.cy, {
            ...common,
            kind: "depression",
            isom: 111,
            orient: Math.round(blob.orient),
            small: !(
              blob.length >= t.contourDepressionLength &&
              blob.width >= t.contourDepressionWidth
            ),
          }),
        );
      }
    }
  }
}

/**
 * Earth banks (104), cliffs (202) and impassable cliffs (201): steep edges with their tags pointing downhill.
 *
 * An edge only counts when it is steeper than `steepSlope` and also clearly steeper than the
 * hillside around it (`bankSlopeExcess`), and its height is the drop that is left once the slope
 * of the hillside is taken out. Otherwise every step on a steep slope would become a bank.
 */
function detectBanks(ctx: Context, out: LandformResult) {
  const { grid, grad, t } = ctx;
  const { width: w, height: h, margin: m, cell } = grid;
  const steep = Math.tan(t.steepSlope * RAD);
  const excess = t.bankSlopeExcess * RAD;
  const maxAngle = 87 * RAD;

  // the slope of the hillside with the small steps smoothed away
  const background = computeGradient(
    new Grid(
      grid.tileWidth,
      grid.tileHeight,
      m,
      cell,
      boxMean(
        grid.data,
        w,
        h,
        Math.max(2, Math.round(t.bankBackgroundScale / cell)),
      ),
    ),
  );
  /** gradient magnitude from which ground counts as steep, given the slope of the hillside */
  const limitFor = (backgroundMag: number) =>
    Math.max(
      steep,
      Math.tan(Math.min(maxAngle, Math.atan(backgroundMag) + excess)),
    );

  // the outline of the steep ground, with the steep side on the left of the direction of travel
  const field = new HeightTile(grid.tileWidth, grid.tileHeight, (x, y) => {
    const i = x + m;
    const j = y + m;
    if (i < 0 || j < 0 || i >= w || j >= h) return NaN;
    const idx = j * w + i;
    return grad.mag[idx] / limitFor(background.mag[idx]);
  });
  const fragments =
    generateIsolines(1, field, (grid.tileWidth - 1) * SUBPIXEL, m)[1] || [];

  for (const fragment of fragments) {
    const n = fragment.length / 2;
    if (n < 4) continue;
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      px[k] = fragment[2 * k] / SUBPIXEL + m;
      py[k] = fragment[2 * k + 1] / SUBPIXEL + m;
    }
    const closed = px[0] === px[n - 1] && py[0] === py[n - 1];
    const unique = closed ? n - 1 : n;
    const good = new Uint8Array(n);
    const heights = new Float64Array(n);
    const slopes = new Float64Array(n);

    for (let k = 0; k < n; k++) {
      const a = closed
        ? (((k - 2) % unique) + unique) % unique
        : Math.max(0, k - 2);
      const b = closed ? (k + 2) % unique : Math.min(n - 1, k + 2);
      const tx = px[b] - px[a];
      const ty = py[b] - py[a];
      const len = Math.hypot(tx, ty);
      if (len === 0) continue;
      const nx = ty / len;
      const ny = -tx / len;
      // only the top edge gets tags: the steep ground has to fall away from it
      const above = grid.sample(px[k] - nx * 1.5, py[k] - ny * 1.5);
      const below = grid.sample(px[k] + nx * 1.5, py[k] + ny * 1.5);
      const top = grid.sample(px[k], py[k]);
      if (!(below < above) || isNaN(top)) continue;
      const bgMag = bilinear(background.mag, w, h, px[k], py[k]);
      const bgX = bilinear(background.gx, w, h, px[k], py[k]);
      const bgY = bilinear(background.gy, w, h, px[k], py[k]);
      if (isNaN(bgMag) || isNaN(bgX) || isNaN(bgY)) continue;
      const limit = limitFor(bgMag);
      const enter = bgMag + 0.9 * (limit - bgMag);
      const leave = bgMag + 0.6 * (limit - bgMag);
      let maxMag = 0;
      let foot = top;
      let reach = 0;
      let inside = false;
      for (let u = 0.5; u <= t.cliffScanDistance / cell; u += 0.5) {
        const fx = px[k] + nx * u;
        const fy = py[k] + ny * u;
        const z = grid.sample(fx, fy);
        const mag = bilinear(grad.mag, w, h, fx, fy);
        if (isNaN(z) || isNaN(mag)) break;
        maxMag = Math.max(maxMag, mag);
        foot = z;
        reach = u;
        if (mag >= enter) inside = true;
        else if (inside && mag < leave) break;
      }
      // the drop that is left once the slope of the hillside is taken out
      const hillside = (bgX * nx + bgY * ny) * reach * cell;
      heights[k] = top - foot + hillside;
      slopes[k] = Math.atan(maxMag) / RAD;
      good[k] = heights[k] >= t.bankMinHeight ? 1 : 0;
    }

    // bridge gaps of a couple of vertices
    for (let k = 1; k < n; k++) {
      if (good[k]) continue;
      let end = k;
      while (end < n && !good[end]) end++;
      if (end < n && good[k - 1] && end - k <= 2) good.fill(1, k, end);
      k = end;
    }

    for (let start = 0; start < n; start++) {
      if (!good[start]) continue;
      let end = start;
      while (end + 1 < n && good[end + 1]) end++;
      const run = end - start + 1;
      const first = start;
      start = end;
      if (run < 3) continue;
      const flat: number[] = [];
      for (let k = first; k <= end; k++) flat.push(px[k], py[k]);
      const smooth = smoothPath(flat, 2);
      if (pathLength(smooth) * cell < t.bankMinLength) continue;
      const height = median(Array.from(heights.slice(first, end + 1)));
      const slope = median(Array.from(slopes.slice(first, end + 1)));
      let kind = "bank";
      let isom = 104;
      if (height >= t.impassableMinHeight && slope >= t.impassableSlope) {
        kind = "impassable_cliff";
        isom = 201;
      } else if (slope >= t.cliffSlope) {
        kind = "cliff";
        isom = 202;
      }
      const tilePoints = toTileUnits(ctx, smooth);
      const properties = { kind, isom };
      lineFeatures(
        ctx,
        tilePoints,
        { ...properties, height: round1(height), slope: Math.round(slope) },
        out.lines,
      );
      out.tickLines.push({ points: tilePoints, properties });
    }
  }
}

interface LinearCandidate {
  /** window coordinates */
  points: number[];
  /** metres */
  length: number;
  /** median depth (or height) relative to the surroundings, metres */
  amplitude: number;
}

/**
 * Finds narrow, elongated runs of pixels where `relief >= threshold`, reduces them to centre
 * lines and keeps the ones that really have a ditch- or ridge-shaped cross section.
 * `sign` is -1 for ditches and 1 for ridges.
 */
function extractLinear(
  ctx: Context,
  relief: Float32Array,
  threshold: number,
  sign: 1 | -1,
  minLength: number,
): LinearCandidate[] {
  const { grid, grad, t } = ctx;
  const { width: w, height: h, cell } = grid;
  const mask = new Uint8Array(w * h);
  for (let k = 0; k < mask.length; k++) {
    if (relief[k] >= threshold && !isNaN(grad.mag[k])) mask[k] = 1;
  }
  const { labels, count } = labelComponents(mask, w, h);
  if (count === 0) return [];
  const area = new Float64Array(count + 1);
  for (let k = 0; k < labels.length; k++) area[labels[k]]++;

  // blobs too small to hold a line of the minimum length are not worth thinning
  const minArea = minLength / cell;
  for (let k = 0; k < mask.length; k++) {
    if (mask[k] && area[labels[k]] < minArea) mask[k] = 0;
  }
  const skeleton = thin(mask, w, h);
  const paths = traceSkeleton(
    skeleton,
    w,
    h,
    Math.max(2, Math.round(4 / cell)),
  ).map((points) => ({
    points,
    label: labels[points[1] * w + points[0]],
    length: pathLength(points) * cell,
  }));
  const skeletonLength = new Float64Array(count + 1);
  for (const p of paths) skeletonLength[p.label] += p.length;

  const probe = Math.max(2, Math.round(4 / cell));
  const result: LinearCandidate[] = [];
  for (const p of paths) {
    if (p.length < minLength) continue;
    const width = (area[p.label] * cell * cell) / skeletonLength[p.label];
    if (
      width > t.linearMaxWidth ||
      skeletonLength[p.label] / width < t.linearMinElongation
    ) {
      continue;
    }
    const n = p.points.length / 2;
    const amplitudes: number[] = [];
    let profiles = 0;
    for (let k = 0; k < n; k++) {
      const x = p.points[2 * k];
      const y = p.points[2 * k + 1];
      amplitudes.push(relief[y * w + x]);
      const a = Math.max(0, k - 2);
      const b = Math.min(n - 1, k + 2);
      const tx = p.points[2 * b] - p.points[2 * a];
      const ty = p.points[2 * b + 1] - p.points[2 * a + 1];
      const len = Math.hypot(tx, ty);
      if (len === 0) continue;
      const nx = ty / len;
      const ny = -tx / len;
      const centre = grid.sample(x, y);
      const left = grid.sample(x + nx * probe, y + ny * probe);
      const right = grid.sample(x - nx * probe, y - ny * probe);
      const need = 0.6 * threshold;
      if (sign * (centre - left) >= need && sign * (centre - right) >= need) {
        profiles++;
      }
    }
    // the centre line has to sit at the bottom of a ditch (or the top of a ridge)
    if (profiles < 0.6 * n) continue;
    result.push({
      points: simplifyPath(smoothPath(p.points, 2), 0.35),
      length: p.length,
      amplitude: median(amplitudes),
    });
  }
  return result;
}

/** Erosion gullies (107, 108) and earth walls (105.1, 106). */
function detectLinear(ctx: Context, out: LandformResult) {
  const { grid, t, o } = ctx;
  const { width: w, height: h, cell } = grid;
  const radius = Math.max(2, Math.round(t.linearScale / cell));
  const mean = boxMean(grid.data, w, h, radius);
  const relief = grid.data.map((v, k) => v - mean[k]);

  if (o.groups.has("gullies")) {
    const depth = relief.map((v) => -v);
    for (const c of extractLinear(
      ctx,
      depth,
      t.smallGullyMinDepth,
      -1,
      t.smallGullyMinLength,
    )) {
      let kind: string;
      let isom: number;
      if (c.amplitude >= t.gullyMinDepth && c.length >= t.gullyMinLength) {
        kind = "erosion_gully";
        isom = 107;
      } else if (
        c.amplitude >= t.smallGullyMinDepth &&
        c.length >= t.smallGullyMinLength
      ) {
        kind = "small_erosion_gully";
        isom = 108;
      } else {
        continue;
      }
      lineFeatures(
        ctx,
        toTileUnits(ctx, c.points),
        {
          kind,
          isom,
          depth: round1(c.amplitude),
          length: Math.round(c.length),
        },
        out.lines,
      );
    }
  }

  if (o.groups.has("walls")) {
    for (const c of extractLinear(
      ctx,
      relief,
      t.ruinedWallMinHeight,
      1,
      Math.min(t.wallMinLength, t.ruinedWallMinLength),
    )) {
      let kind: string;
      let isom: number;
      if (c.amplitude >= t.wallMinHeight && c.length >= t.wallMinLength) {
        kind = "earth_wall";
        isom = 105.1;
      } else if (
        c.amplitude >= t.ruinedWallMinHeight &&
        c.length >= t.ruinedWallMinLength
      ) {
        kind = "ruined_earth_wall";
        isom = 106;
      } else {
        continue;
      }
      lineFeatures(
        ctx,
        toTileUnits(ctx, c.points),
        {
          kind,
          isom,
          height: round1(c.amplitude),
          length: Math.round(c.length),
        },
        out.lines,
      );
    }
  }
}

/** Broken ground (113) and very broken ground (114): areas where fine-scale relief is large. */
function detectBrokenGround(ctx: Context, out: LandformResult) {
  const { grid, grad, t, s } = ctx;
  const { width: w, height: h, margin: m, cell } = grid;
  const steep = Math.tan(t.steepSlope * RAD);

  const fine = boxMean(
    grid.data,
    w,
    h,
    Math.max(1, Math.round(t.roughFineScale / cell)),
  );
  const squared = new Float32Array(w * h);
  for (let k = 0; k < squared.length; k++) {
    const v = grid.data[k] - fine[k];
    // cliffs and banks are not broken ground
    squared[k] = grad.mag[k] >= steep ? 0 : v * v;
  }
  const meanSquare = boxMean(
    squared,
    w,
    h,
    Math.max(2, Math.round(t.roughScale / cell)),
  );
  const roughness = meanSquare.map(Math.sqrt);
  const squareUnitsToMetres = (cell / s) ** 2;

  const levels: [number, string, number][] = [
    [t.brokenRoughness, "broken_ground", 113],
    [t.veryBrokenRoughness, "very_broken_ground", 114],
  ];
  for (const [threshold, kind, isom] of levels) {
    // anything touching the window edge is set to zero so that every outline closes
    const field = new Float32Array(w * h);
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const v = roughness[j * w + i] / threshold;
        field[j * w + i] = isNaN(v) ? 0 : v;
      }
    }
    const tile = new HeightTile(grid.tileWidth, grid.tileHeight, (x, y) => {
      const i = x + m;
      const j = y + m;
      return i < 0 || j < 0 || i >= w || j >= h ? 0 : field[j * w + i];
    });
    const rings = (
      generateIsolines(1, tile, (grid.tileWidth - 1) * SUBPIXEL, m)[1] || []
    ).filter(
      (r) =>
        r.length >= 8 && r[0] === r[r.length - 2] && r[1] === r[r.length - 1],
    );

    const outers: { ring: number[]; area: number; holes: number[][] }[] = [];
    const holes: { ring: number[]; area: number }[] = [];
    for (const raw of rings) {
      let ring: number[] = [];
      for (let k = 0; k < raw.length; k += 2) {
        ring.push(
          Math.round((raw[k] / SUBPIXEL + 0.5) * s),
          Math.round((raw[k + 1] / SUBPIXEL + 0.5) * s),
        );
      }
      // marching squares keeps the rough ground on the left, so outlines of rough ground have a negative area
      const area = signedArea(ring);
      if (Math.abs(area) * squareUnitsToMetres < t.brokenMinArea) continue;
      // tile features want exterior rings clockwise and holes counterclockwise
      ring = reverseRing(ring);
      if (area < 0) outers.push({ ring, area: -area, holes: [] });
      else holes.push({ ring, area });
    }
    for (const hole of holes) {
      let owner: (typeof outers)[number] | undefined;
      for (const outer of outers) {
        if (
          pointInRing(hole.ring[0], hole.ring[1], outer.ring) &&
          (!owner || outer.area < owner.area)
        ) {
          owner = outer;
        }
      }
      owner?.holes.push(hole.ring);
    }
    const b = ctx.bufferUnits;
    for (const outer of outers) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < outer.ring.length; k += 2) {
        minX = Math.min(minX, outer.ring[k]);
        maxX = Math.max(maxX, outer.ring[k]);
        minY = Math.min(minY, outer.ring[k + 1]);
        maxY = Math.max(maxY, outer.ring[k + 1]);
      }
      if (
        maxX < -b ||
        maxY < -b ||
        minX > ctx.extent + b ||
        minY > ctx.extent + b
      ) {
        continue;
      }
      out.areas.push({
        type: GeomType.POLYGON,
        geometry: [outer.ring, ...outer.holes],
        properties: { kind, isom },
      });
    }
  }
}

/** Form lines (103): half-interval contours, kept only where the ground is too flat for the main contours to describe it. */
function detectFormLines(
  ctx: Context,
  corners: HeightTile,
  out: LandformResult,
) {
  const { grid, grad, t, o, s } = ctx;
  const { width: w, height: h, margin: m, cell } = grid;
  const interval = t.contourInterval;
  if (!(interval > 0)) return;
  const maxMag = Math.tan(t.formLineMaxSlope * RAD);
  const lines = generateIsolines(interval / 2, corners, ctx.extent, o.buffer);
  for (const [eleString, list] of Object.entries(lines)) {
    const ele = Number(eleString);
    if (Math.abs(ele / interval - Math.round(ele / interval)) < 1e-6) continue;
    for (const line of list) {
      const n = line.length / 2;
      const flat = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const mag = bilinear(
          grad.mag,
          w,
          h,
          line[2 * k] / s - 0.5 + m,
          line[2 * k + 1] / s - 0.5 + m,
        );
        flat[k] = mag <= maxMag ? 1 : 0;
      }
      for (let start = 0; start < n; start++) {
        if (!flat[start]) continue;
        let end = start;
        while (end + 1 < n && flat[end + 1]) end++;
        const first = start;
        start = end;
        const piece = line.slice(2 * first, 2 * end + 2);
        if (piece.length < 6) continue;
        if (pathLength(piece) * (cell / s) < t.formLineMinLength) continue;
        lineFeatures(
          ctx,
          piece,
          { kind: "form_line", isom: 103, ele },
          out.lines,
        );
      }
    }
  }
}

/**
 * Detects orienteering landforms in an elevation window.
 *
 * @param grid elevations in metres, as pixel centers, with a margin around the tile
 * @param options resolved options
 * @param corners elevations at pixel corners (width + 1 values), only needed for form lines
 */
export function detectLandforms(
  grid: Grid,
  options: ResolvedLandformOptions,
  corners?: HeightTile,
): LandformResult {
  const s = options.extent / grid.tileWidth;
  const ctx: Context = {
    grid,
    grad: computeGradient(grid),
    t: options.thresholds,
    o: options,
    extent: options.extent,
    s,
    bufferUnits: options.buffer * s,
    toX: (i) => (i - grid.margin + 0.5) * s,
    toY: (j) => (j - grid.margin + 0.5) * s,
  };
  const out: LandformResult = {
    points: [],
    lines: [],
    ticks: [],
    tickLines: [],
    areas: [],
  };
  const groups = options.groups;
  if (
    groups.has("knolls") ||
    groups.has("depressions") ||
    groups.has("boulders")
  ) {
    detectBlobFeatures(ctx, out);
  }
  if (groups.has("banks")) detectBanks(ctx, out);
  if (groups.has("gullies") || groups.has("walls")) detectLinear(ctx, out);
  if (groups.has("brokenGround")) detectBrokenGround(ctx, out);
  out.ticks = makeTicks(
    out.tickLines,
    options.extent,
    options.tickSpacing,
    options.tickLength,
  );
  if (groups.has("formLines") && corners) detectFormLines(ctx, corners, out);
  return out;
}

/** Side length of a web mercator tile on the ground in metres, at the tile's latitude. */
export function groundTileSize(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / Math.pow(2, z);
  const latitude = Math.atan(Math.sinh(n));
  return (40075016.686 / Math.pow(2, z)) * Math.cos(latitude);
}

/** Pixels of surroundings the filters need, given the pixel size on the ground. */
export function landformMargin(t: LandformThresholds, cell: number): number {
  const reach = Math.max(
    t.linearScale,
    t.roughScale,
    t.cliffScanDistance,
    t.bankBackgroundScale,
    12,
  );
  return Math.ceil(reach / cell) + 2;
}

/**
 * Prepares a virtual tile (a tile plus its neighbors) for analysis: subsamples small tiles
 * and materializes `margin` pixels of surroundings at the final resolution.
 */
export function prepareAnalysisTile(
  virtualTile: HeightTile,
  subsampleBelow: number,
  margin: number,
): HeightTile {
  let factor = 1;
  while (virtualTile.width * factor < subsampleBelow) factor *= 2;
  const marginAt = (f: number) => Math.ceil((margin * f) / factor) + 3;
  if (factor === 1) return virtualTile.materialize(margin);
  let tile = virtualTile.materialize(marginAt(1));
  for (let f = 2; f <= factor; f *= 2) {
    tile = tile
      .subsamplePixelCenters(2)
      .materialize(f === factor ? margin : marginAt(f));
  }
  return tile;
}
