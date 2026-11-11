import { HeightTile } from "./height-tile";
import { Grid } from "./landform-grid";
import type { LandformThresholds, ResolvedLandformOptions } from "./landform-options";
import type { Feature } from "./vtpbf";
/** Detected features, in vector tile coordinates, ready to be encoded into layers. */
export interface LandformResult {
    /** knolls, depressions, pits, boulders */
    points: Feature[];
    /** banks, cliffs, gullies, walls and form lines */
    lines: Feature[];
    /** downhill tags for banks and cliffs */
    ticks: Feature[];
    /** broken ground */
    areas: Feature[];
}
/**
 * Detects orienteering landforms in an elevation window.
 *
 * @param grid elevations in metres, as pixel centers, with a margin around the tile
 * @param options resolved options
 * @param corners elevations at pixel corners (width + 1 values), only needed for form lines
 */
export declare function detectLandforms(grid: Grid, options: ResolvedLandformOptions, corners?: HeightTile): LandformResult;
/** Side length of a web mercator tile on the ground in metres, at the tile's latitude. */
export declare function groundTileSize(z: number, y: number): number;
/** Pixels of surroundings the filters need, given the pixel size on the ground. */
export declare function landformMargin(t: LandformThresholds, cell: number): number;
/**
 * Prepares a virtual tile (a tile plus its neighbors) for analysis: subsamples small tiles
 * and materializes `margin` pixels of surroundings at the final resolution.
 */
export declare function prepareAnalysisTile(virtualTile: HeightTile, subsampleBelow: number, margin: number): HeightTile;
