import type { HeightTile } from "./height-tile";
/** Bilinear interpolation in a row-major raster, `NaN` when outside of it. */
export declare function bilinear(data: Float32Array, width: number, height: number, fx: number, fy: number): number;
/**
 * A window of elevations (in metres) sampled at pixel centers: the tile itself plus `margin`
 * pixels on every side, so that features and filters near the tile edge see their surroundings.
 *
 * Window index `(i, j)` is tile pixel `(i - margin, j - margin)`.
 */
export declare class Grid {
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
    constructor(tileWidth: number, tileHeight: number, margin: number, cell: number, data: Float32Array);
    /** Reads a window out of a height tile whose `get` is valid within `margin` pixels of the tile. */
    static fromHeightTile(tile: HeightTile, margin: number, cell: number): Grid;
    /** Builds a window from a function of tile pixel coordinates. */
    static fromFunction(tileWidth: number, tileHeight: number, margin: number, cell: number, fn: (x: number, y: number) => number): Grid;
    /** Elevation at fractional window coordinates. */
    sample(fx: number, fy: number): number;
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
export declare function computeGradient(grid: Grid): Gradient;
/**
 * Mean of a `(2 * radius + 1)` square window around every pixel, ignoring `NaN` inputs.
 * Pixels that are `NaN` themselves stay `NaN`. Windows are clipped at the raster edge.
 */
export declare function boxMean(data: Float32Array, width: number, height: number, radius: number): Float32Array;
