import type { HeightTile } from "./height-tile";

/** Bilinear interpolation in a row-major raster, `NaN` when outside of it. */
export function bilinear(
  data: Float32Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (!(x0 >= 0 && y0 >= 0 && x0 + 1 < width && y0 + 1 < height)) {
    return NaN;
  }
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * width + x0;
  const a = data[i];
  const b = data[i + 1];
  const c = data[i + width];
  const d = data[i + width + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * A window of elevations (in metres) sampled at pixel centers: the tile itself plus `margin`
 * pixels on every side, so that features and filters near the tile edge see their surroundings.
 *
 * Window index `(i, j)` is tile pixel `(i - margin, j - margin)`.
 */
export class Grid {
  /** Width of the whole window including margins */
  width: number;
  height: number;
  data: Float32Array;
  margin: number;
  /** Width of the tile without margins, in pixels */
  tileWidth: number;
  tileHeight: number;
  /** Size of one pixel on the ground, in metres */
  cell: number;

  constructor(
    tileWidth: number,
    tileHeight: number,
    margin: number,
    cell: number,
    data: Float32Array,
  ) {
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
    this.margin = margin;
    this.cell = cell;
    this.width = tileWidth + 2 * margin;
    this.height = tileHeight + 2 * margin;
    if (data.length !== this.width * this.height) {
      throw new Error("Grid data does not match its dimensions");
    }
    this.data = data;
  }

  /** Reads a window out of a height tile whose `get` is valid within `margin` pixels of the tile. */
  static fromHeightTile(tile: HeightTile, margin: number, cell: number): Grid {
    const width = tile.width + 2 * margin;
    const height = tile.height + 2 * margin;
    const data = new Float32Array(width * height);
    let idx = 0;
    for (let y = -margin; y < tile.height + margin; y++) {
      for (let x = -margin; x < tile.width + margin; x++) {
        data[idx++] = tile.get(x, y);
      }
    }
    return new Grid(tile.width, tile.height, margin, cell, data);
  }

  /** Builds a window from a function of tile pixel coordinates. */
  static fromFunction(
    tileWidth: number,
    tileHeight: number,
    margin: number,
    cell: number,
    fn: (x: number, y: number) => number,
  ): Grid {
    const width = tileWidth + 2 * margin;
    const height = tileHeight + 2 * margin;
    const data = new Float32Array(width * height);
    let idx = 0;
    for (let y = -margin; y < tileHeight + margin; y++) {
      for (let x = -margin; x < tileWidth + margin; x++) {
        data[idx++] = fn(x, y);
      }
    }
    return new Grid(tileWidth, tileHeight, margin, cell, data);
  }

  /** Elevation at fractional window coordinates. */
  sample(fx: number, fy: number): number {
    return bilinear(this.data, this.width, this.height, fx, fy);
  }
}

export interface Gradient {
  /** dz/dx (positive when the ground rises to the east), dimensionless */
  gx: Float32Array;
  /** dz/dy (positive when the ground rises to the south), dimensionless */
  gy: Float32Array;
  /** Gradient magnitude, which is tan(slope angle) */
  mag: Float32Array;
}

/** Sobel gradient of the elevation window. The outermost ring of pixels is `NaN`. */
export function computeGradient(grid: Grid): Gradient {
  const { width: w, height: h, data, cell } = grid;
  const gx = new Float32Array(w * h).fill(NaN);
  const gy = new Float32Array(w * h).fill(NaN);
  const mag = new Float32Array(w * h).fill(NaN);
  const k = 1 / (8 * cell);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const idx = j * w + i;
      const a = data[idx - w - 1];
      const b = data[idx - w];
      const c = data[idx - w + 1];
      const d = data[idx - 1];
      const f = data[idx + 1];
      const g = data[idx + w - 1];
      const hh = data[idx + w];
      const ii = data[idx + w + 1];
      const dx = (c + 2 * f + ii - (a + 2 * d + g)) * k;
      const dy = (g + 2 * hh + ii - (a + 2 * b + c)) * k;
      gx[idx] = dx;
      gy[idx] = dy;
      mag[idx] = Math.sqrt(dx * dx + dy * dy);
    }
  }
  return { gx, gy, mag };
}

/**
 * Mean of a `(2 * radius + 1)` square window around every pixel, ignoring `NaN` inputs.
 * Pixels that are `NaN` themselves stay `NaN`. Windows are clipped at the raster edge.
 */
export function boxMean(
  data: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const count = new Int32Array(stride * (height + 1));
  for (let j = 0; j < height; j++) {
    let rowSum = 0;
    let rowCount = 0;
    for (let i = 0; i < width; i++) {
      const v = data[j * width + i];
      if (!isNaN(v)) {
        rowSum += v;
        rowCount++;
      }
      const at = (j + 1) * stride + i + 1;
      sum[at] = sum[at - stride] + rowSum;
      count[at] = count[at - stride] + rowCount;
    }
  }
  const out = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const y0 = Math.max(0, j - radius);
    const y1 = Math.min(height, j + radius + 1);
    for (let i = 0; i < width; i++) {
      if (isNaN(data[j * width + i])) {
        out[j * width + i] = NaN;
        continue;
      }
      const x0 = Math.max(0, i - radius);
      const x1 = Math.min(width, i + radius + 1);
      const s =
        sum[y1 * stride + x1] -
        sum[y0 * stride + x1] -
        sum[y1 * stride + x0] +
        sum[y0 * stride + x0];
      const c =
        count[y1 * stride + x1] -
        count[y0 * stride + x1] -
        count[y1 * stride + x0] +
        count[y0 * stride + x0];
      out[j * width + i] = c === 0 ? NaN : s / c;
    }
  }
  return out;
}
