/**
 * Options and defaults for DEM-derived orienteering landform detection.
 *
 * Distances are metres, heights/depths are metres, slopes are degrees.
 * Where a default comes from the ISOM 2017-2 specification the symbol number is given.
 */

/** Groups of features that can be switched on and off. */
export type LandformGroup =
  /** Small knoll (109) and small elongated knoll (110) */
  | "knolls"
  /** Small depression (111) and pit (112) */
  | "depressions"
  /** Earth bank (104), cliff (202) and impassable cliff (201), with downhill tags */
  | "banks"
  /** Erosion gully (107) and small erosion gully (108) */
  | "gullies"
  /** Earth wall (105.1) and ruined earth wall (106) */
  | "walls"
  /** Form lines (103): half-interval contours in flat ground */
  | "formLines"
  /** Broken ground (113) and very broken ground (114) areas */
  | "brokenGround"
  /** Boulder (204) and large boulder (205) candidates. Off by default, see README. */
  | "boulders";

export const ALL_LANDFORM_GROUPS: LandformGroup[] = [
  "knolls",
  "depressions",
  "banks",
  "gullies",
  "walls",
  "formLines",
  "brokenGround",
  "boulders",
];

export const DEFAULT_LANDFORM_GROUPS: LandformGroup[] =
  ALL_LANDFORM_GROUPS.filter((g) => g !== "boulders");

export interface LandformThresholds {
  /** DEMs coarser than this (metres per source pixel) produce no landform features. */
  maxCellSize: number;
  /** Ignore blobs made of fewer pixels than this, to suppress single-pixel noise. */
  minCells: number;
  /** Contour interval of the map, used to flag features that a contour already shows. */
  contourInterval: number;

  /** ISOM 109/110: minimum height of a knoll. */
  knollMinHeight: number;
  /** Knolls longer than this are hills, drawn with contours rather than as symbols. */
  knollMaxLength: number;
  /** Major/minor axis ratio above which a knoll is elongated (110). */
  elongationRatio: number;
  /** ISOM 101: a contour knoll needs at least this length and width, smaller ones are "small" (109/110). */
  contourKnollLength: number;
  contourKnollWidth: number;

  /** ISOM 111 small depression: minimum depth and width. */
  depressionMinDepth: number;
  depressionMinWidth: number;
  /** Depressions longer than this are basins, drawn with contours. */
  depressionMaxLength: number;
  /** ISOM 101: a contour depression needs at least this length and width. */
  contourDepressionLength: number;
  contourDepressionWidth: number;
  /** ISOM 112 pit: minimum depth and width, plus wall steepness and size that separate pits from depressions. */
  pitMinDepth: number;
  pitMinWidth: number;
  pitMinWallSlope: number;
  pitMaxLength: number;

  /** Slope at which ground counts as a steep edge (earth bank). */
  steepSlope: number;
  /**
   * Degrees by which the slope on a bank has to exceed the slope of the hillside around it,
   * so that steps on a steep hillside are not all banks. The bank height is measured with the hillside slope removed.
   */
  bankSlopeExcess: number;
  /** Radius in metres over which the hillside slope is averaged. */
  bankBackgroundScale: number;
  /** ISOM 104: minimum height and length of an earth bank. */
  bankMinHeight: number;
  bankMinLength: number;
  /** Median slope from which a steep edge is a rock cliff (202) rather than an earth bank. */
  cliffSlope: number;
  /** Slope and height from which a cliff is impassable (201). */
  impassableSlope: number;
  impassableMinHeight: number;
  /** How far downhill from a steep edge to look for the foot of the slope. */
  cliffScanDistance: number;

  /** Neighbourhood radius used to find gullies and walls (a TPI window). */
  linearScale: number;
  /** ISOM 108: minimum depth and length of a small erosion gully. */
  smallGullyMinDepth: number;
  smallGullyMinLength: number;
  /** ISOM 107: minimum depth and length of an erosion gully. */
  gullyMinDepth: number;
  gullyMinLength: number;
  /** Gullies and walls wider than this are valleys and ridges, not linear features. */
  linearMaxWidth: number;
  /** Minimum length/width ratio of a linear feature. */
  linearMinElongation: number;
  /** ISOM 105.1 earth wall and 106 ruined earth wall: minimum height and length. */
  wallMinHeight: number;
  wallMinLength: number;
  ruinedWallMinHeight: number;
  ruinedWallMinLength: number;

  /** Form lines are kept only where the ground is flatter than this. */
  formLineMaxSlope: number;
  formLineMinLength: number;

  /** Window used to measure fine-scale relief for broken ground. */
  roughFineScale: number;
  /** Window over which fine-scale relief is averaged for broken ground. */
  roughScale: number;
  /** RMS fine-scale relief (metres) above which ground is broken / very broken. */
  brokenRoughness: number;
  veryBrokenRoughness: number;
  brokenMinArea: number;

  /** ISOM 204/205: boulder and large boulder minimum heights, maximum length, and minimum average slope from top to edge. */
  boulderMinHeight: number;
  largeBoulderMinHeight: number;
  boulderMaxLength: number;
  boulderMinWallSlope: number;
}

export const DEFAULT_LANDFORM_THRESHOLDS: LandformThresholds = {
  maxCellSize: 4,
  minCells: 3,
  contourInterval: 5,

  knollMinHeight: 1,
  knollMaxLength: 60,
  elongationRatio: 1.7,
  contourKnollLength: 13.5,
  contourKnollWidth: 9,

  depressionMinDepth: 1,
  depressionMinWidth: 2,
  depressionMaxLength: 80,
  contourDepressionLength: 16.5,
  contourDepressionWidth: 10.5,
  pitMinDepth: 1,
  pitMinWidth: 1,
  pitMinWallSlope: 35,
  pitMaxLength: 15,

  steepSlope: 40,
  bankSlopeExcess: 20,
  bankBackgroundScale: 6,
  bankMinHeight: 1,
  bankMinLength: 9,
  cliffSlope: 55,
  impassableSlope: 65,
  impassableMinHeight: 4,
  cliffScanDistance: 15,

  linearScale: 10,
  smallGullyMinDepth: 0.5,
  smallGullyMinLength: 10.5,
  gullyMinDepth: 1,
  gullyMinLength: 17.25,
  linearMaxWidth: 15,
  linearMinElongation: 3,
  wallMinHeight: 1,
  wallMinLength: 21,
  ruinedWallMinHeight: 0.5,
  ruinedWallMinLength: 55,

  formLineMaxSlope: 3,
  formLineMinLength: 20,

  roughFineScale: 2.5,
  roughScale: 12,
  brokenRoughness: 0.3,
  veryBrokenRoughness: 0.6,
  brokenMinArea: 400,

  boulderMinHeight: 1,
  largeBoulderMinHeight: 2,
  boulderMaxLength: 6,
  boulderMinWallSlope: 45,
};

/** Parameters to use when detecting landforms in a vector tile from raw elevation data. */
export interface LandformTileOptions {
  /** Which groups of features to detect (default: everything except boulders). */
  features?: LandformGroup[];
  /** Override any of the detection thresholds, see {@link DEFAULT_LANDFORM_THRESHOLDS}. */
  thresholds?: Partial<LandformThresholds>;
  /** Grid size of the vector tile (default 4096) */
  extent?: number;
  /** How many pixels of lines to keep beyond each tile edge (default 1) */
  buffer?: number;
  /** Same meaning as for contour tiles: request `raster-dem` tiles from lower zoom levels. */
  overzoom?: number;
  /** Same meaning as for contour tiles: subsample tiles smaller than this many pixels. */
  subsampleBelow?: number;
  /** Distance between cliff/earth bank tags, in tile units (default 80, about 10px on a 512px tile). */
  tickSpacing?: number;
  /** Length of cliff/earth bank tags, in tile units (default 36). */
  tickLength?: number;
}

export interface ResolvedLandformOptions {
  groups: Set<LandformGroup>;
  thresholds: LandformThresholds;
  extent: number;
  buffer: number;
  overzoom: number;
  subsampleBelow: number;
  tickSpacing: number;
  tickLength: number;
  /** Stable string identifying these options, for caching. */
  key: string;
  /** The same without the tag spacing and length, which don't change what is detected. */
  detectionKey: string;
}

export function resolveLandformOptions(
  options: LandformTileOptions = {},
): ResolvedLandformOptions {
  const groups = new Set<LandformGroup>(
    options.features || DEFAULT_LANDFORM_GROUPS,
  );
  const thresholds: LandformThresholds = {
    ...DEFAULT_LANDFORM_THRESHOLDS,
    ...(options.thresholds || {}),
  };
  const resolved = {
    extent: options.extent ?? 4096,
    buffer: options.buffer ?? 1,
    overzoom: options.overzoom ?? 0,
    subsampleBelow: options.subsampleBelow ?? 100,
    tickSpacing: options.tickSpacing ?? 80,
    tickLength: options.tickLength ?? 36,
  };
  const sortedGroups = [...groups].sort();
  const detection: Record<string, unknown> = { ...resolved };
  delete detection.tickSpacing;
  delete detection.tickLength;
  const sortedThresholds = Object.fromEntries(
    Object.entries(thresholds).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return {
    groups,
    thresholds,
    ...resolved,
    key: JSON.stringify([sortedGroups, sortedThresholds, resolved]),
    detectionKey: JSON.stringify([sortedGroups, sortedThresholds, detection]),
  };
}
