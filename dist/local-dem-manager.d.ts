import AsyncCache from "./cache";
import { HeightTile } from "./height-tile";
import type { ContourTile, DecodeImageFunction, DemManager, DemManagerInitizlizationParameters, DemTile, Encoding, FetchResponse, GetTileFunction, IndividualContourTileOptions, LandformTileOptions } from "./types";
import { Timer } from "./performance";
/**
 * Caches, decodes, and processes raster tiles in the current thread.
 */
export declare class LocalDemManager implements DemManager {
    tileCache: AsyncCache<string, FetchResponse>;
    parsedCache: AsyncCache<string, DemTile>;
    contourCache: AsyncCache<string, ContourTile>;
    landformCache: AsyncCache<string, ContourTile>;
    demUrlPattern: string;
    encoding: Encoding;
    maxzoom: number;
    timeoutMs: number;
    loaded: Promise<void>;
    decodeImage: DecodeImageFunction;
    getTile: GetTileFunction;
    constructor(options: DemManagerInitizlizationParameters);
    fetchTile(z: number, x: number, y: number, parentAbortController: AbortController, timer?: Timer): Promise<FetchResponse>;
    fetchAndParseTile: (z: number, x: number, y: number, abortController: AbortController, timer?: Timer) => Promise<DemTile>;
    fetchDem(z: number, x: number, y: number, options: Partial<IndividualContourTileOptions>, abortController: AbortController, timer?: Timer): Promise<HeightTile>;
    fetchContourTile(z: number, x: number, y: number, options: IndividualContourTileOptions, parentAbortController: AbortController, timer?: Timer): Promise<ContourTile>;
    /**
     * Detects orienteering landforms around a tile: small knolls, pits, depressions, earth banks and
     * cliffs (with tags), gullies, earth walls, form lines and broken ground. Needs a high resolution DEM.
     */
    fetchLandformTile(z: number, x: number, y: number, options: LandformTileOptions, parentAbortController: AbortController, timer?: Timer): Promise<ContourTile>;
}
