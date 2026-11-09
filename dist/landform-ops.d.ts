/**
 * Fills every depression in the raster up to the level at which water would spill out of it
 * (priority-flood, Barnes et al. 2014). Water can leave through the raster border or through
 * `NaN` pixels. Returns the filled surface, so `filled - data` is the depth of each depression.
 */
export declare function priorityFlood(data: Float32Array, width: number, height: number): Float32Array;
/** Labels 8-connected groups of set pixels with 1..count. */
export declare function labelComponents(mask: Uint8Array, width: number, height: number): {
    labels: Int32Array;
    count: number;
};
/** Zhang-Suen thinning: reduces blobs to one-pixel wide skeletons. Pixels on the raster border are cleared. */
export declare function thin(mask: Uint8Array, width: number, height: number): Uint8Array;
/**
 * Walks a one-pixel skeleton and returns its branches as flat `[i0, j0, i1, j1, ...]` pixel
 * coordinates. Short side branches (`spurLength` pixels or fewer) that end in a free tip are
 * dropped, and branches that meet at a node with nothing else attached are joined.
 */
export declare function traceSkeleton(skeleton: Uint8Array, width: number, height: number, spurLength: number): number[][];
/** Three-point moving average of a flat polyline, keeping the end points fixed. */
export declare function smoothPath(points: number[], passes: number): number[];
/** Douglas-Peucker simplification of a flat polyline. */
export declare function simplifyPath(points: number[], tolerance: number): number[];
/** Length of a flat polyline. */
export declare function pathLength(points: number[]): number;
/** Shoelace area of a flat ring (positive when clockwise on screen, with y pointing down). */
export declare function signedArea(ring: number[]): number;
/** Ray-casting point in ring test. */
export declare function pointInRing(x: number, y: number, ring: number[]): boolean;
/**
 * Clips a flat polyline to a rectangle, interpolating new vertices where it crosses the edge.
 * A line that leaves and re-enters the rectangle becomes several pieces.
 */
export declare function clipPolyline(points: number[], minX: number, minY: number, maxX: number, maxY: number): number[][];
export declare function median(values: number[]): number;
export declare function percentile(values: number[], p: number): number;
