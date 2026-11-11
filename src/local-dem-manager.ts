import AsyncCache from "./cache";
import defaultDecodeImage from "./decode-image";
import { HeightTile } from "./height-tile";
import generateIsolines from "./isolines";
import { copy, encodeIndividualOptions, isAborted, withTimeout } from "./utils";
import { Grid } from "./landform-grid";
<<<<<<< HEAD
import {
  resolveLandformOptions,
  type ResolvedLandformOptions,
} from "./landform-options";
import {
  detectLandforms,
  groundTileSize,
  makeTicks,
  type LandformResult,
=======
import { resolveLandformOptions } from "./landform-options";
import {
  detectLandforms,
  groundTileSize,
>>>>>>> cfd2be6413180125f177f5fbe7b6615f72f5cccb
  landformMargin,
  prepareAnalysisTile,
} from "./landforms";
import type {
  ContourTile,
  DecodeImageFunction,
  DemManager,
  DemManagerInitizlizationParameters,
  DemTile,
  Encoding,
  FetchResponse,
  GetTileFunction,
  IndividualContourTileOptions,
  LandformTileOptions,
} from "./types";
import encodeVectorTile, { GeomType } from "./vtpbf";
import { Timer } from "./performance";

const defaultGetTile: GetTileFunction = async (
  url: string,
  abortController: AbortController,
) => {
  const options: RequestInit = {
    signal: abortController.signal,
  };
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Bad response: ${response.status} for ${url}`);
  }
  return {
    data: await response.blob(),
    expires: response.headers.get("expires") || undefined,
    cacheControl: response.headers.get("cache-control") || undefined,
  };
};

/**
 * Caches, decodes, and processes raster tiles in the current thread.
 */
export class LocalDemManager implements DemManager {
  tileCache: AsyncCache<string, FetchResponse>;
  parsedCache: AsyncCache<string, DemTile>;
  contourCache: AsyncCache<string, ContourTile>;
  landformCache: AsyncCache<string, ContourTile>;
<<<<<<< HEAD
  landformDetectionCache: AsyncCache<string, LandformResult | undefined>;
=======
>>>>>>> cfd2be6413180125f177f5fbe7b6615f72f5cccb
  demUrlPattern: string;
  encoding: Encoding;
  maxzoom: number;
  timeoutMs: number;
  loaded = Promise.resolve();
  decodeImage: DecodeImageFunction;
  getTile: GetTileFunction;

  constructor(options: DemManagerInitizlizationParameters) {
    this.tileCache = new AsyncCache(options.cacheSize);
    this.parsedCache = new AsyncCache(options.cacheSize);
    this.contourCache = new AsyncCache(options.cacheSize);
    this.landformCache = new AsyncCache(options.cacheSize);
<<<<<<< HEAD
    this.landformDetectionCache = new AsyncCache(options.cacheSize);
=======
>>>>>>> cfd2be6413180125f177f5fbe7b6615f72f5cccb
    this.timeoutMs = options.timeoutMs;
    this.demUrlPattern = options.demUrlPattern;
    this.encoding = options.encoding;
    this.maxzoom = options.maxzoom;
    this.decodeImage = options.decodeImage || defaultDecodeImage;
    this.getTile = options.getTile || defaultGetTile;
  }

  fetchTile(
    z: number,
    x: number,
    y: number,
    parentAbortController: AbortController,
    timer?: Timer,
  ): Promise<FetchResponse> {
    const url = this.demUrlPattern
      .replace("{z}", z.toString())
      .replace("{x}", x.toString())
      .replace("{y}", y.toString());
    timer?.useTile(url);
    return this.tileCache.get(
      url,
      (_, childAbortController) => {
        timer?.fetchTile(url);
        const mark = timer?.marker("fetch");
        return withTimeout(
          this.timeoutMs,
          this.getTile(url, childAbortController).finally(() => mark?.()),
          childAbortController,
          `Fetching DEM tile ${url}`,
        );
      },
      parentAbortController,
    );
  }
  fetchAndParseTile = (
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<DemTile> => {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const url = this.demUrlPattern
      .replace("{z}", z.toString())
      .replace("{x}", x.toString())
      .replace("{y}", y.toString());

    timer?.useTile(url);

    return this.parsedCache.get(
      url,
      async (_, childAbortController) => {
        const response = await self.fetchTile(
          z,
          x,
          y,
          childAbortController,
          timer,
        );
        if (isAborted(childAbortController)) throw new Error("canceled");
        const promise = self.decodeImage(
          response.data,
          self.encoding,
          childAbortController,
        );
        const mark = timer?.marker("decode");
        const result = await promise;
        mark?.();
        return result;
      },
      abortController,
    );
  };

  async fetchDem(
    z: number,
    x: number,
    y: number,
    options: Partial<IndividualContourTileOptions>,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<HeightTile> {
    const zoom = Math.max(
      0,
      Math.min(z - (options.overzoom || 0), this.maxzoom),
    );
    const subZ = z - zoom;
    const div = 1 << subZ;
    const newX = Math.floor(x / div);
    const newY = Math.floor(y / div);

    const tile = await this.fetchAndParseTile(
      zoom,
      newX,
      newY,
      abortController,
      timer,
    );

    return HeightTile.fromRawDem(tile).split(subZ, x % div, y % div);
  }

  fetchContourTile(
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    parentAbortController: AbortController,
    timer?: Timer,
  ): Promise<ContourTile> {
    const {
      levels,
      multiplier = 1,
      buffer = 1,
      extent = 4096,
      contourLayer = "contours",
      elevationKey = "ele",
      levelKey = "level",
      subsampleBelow = 100,
    } = options;

    // no levels means less than min zoom with levels specified
    if (!levels || levels.length === 0) {
      return Promise.resolve({ arrayBuffer: new ArrayBuffer(0) });
    }
    const key = [z, x, y, encodeIndividualOptions(options)].join("/");
    const cached = this.contourCache.get(
      key,
      async (_, childAbortController) => {
        const max = 1 << z;
        const neighborPromises: (Promise<HeightTile> | undefined)[] = [];
        for (let iy = y - 1; iy <= y + 1; iy++) {
          for (let ix = x - 1; ix <= x + 1; ix++) {
            neighborPromises.push(
              iy < 0 || iy >= max
                ? undefined
                : this.fetchDem(
                    z,
                    (ix + max) % max,
                    iy,
                    options,
                    childAbortController,
                    timer,
                  ),
            );
          }
        }
        const neighbors = await Promise.all(neighborPromises);
        let virtualTile = HeightTile.combineNeighbors(neighbors);
        if (!virtualTile || isAborted(childAbortController)) {
          return { arrayBuffer: new Uint8Array().buffer };
        }
        const mark = timer?.marker("isoline");

        if (virtualTile.width >= subsampleBelow) {
          virtualTile = virtualTile.materialize(2);
        } else {
          while (virtualTile.width < subsampleBelow) {
            virtualTile = virtualTile.subsamplePixelCenters(2).materialize(2);
          }
        }

        virtualTile = virtualTile
          .averagePixelCentersToGrid()
          .scaleElevation(multiplier)
          .materialize(1);

        const isolines = generateIsolines(
          levels[0],
          virtualTile,
          extent,
          buffer,
        );

        mark?.();
        const result = encodeVectorTile({
          extent,
          layers: {
            [contourLayer]: {
              features: Object.entries(isolines).map(([eleString, geom]) => {
                const ele = Number(eleString);
                return {
                  type: GeomType.LINESTRING,
                  geometry: geom,
                  properties: {
                    [elevationKey]: ele,
                    [levelKey]: Math.max(
                      ...levels.map((l, i) => (ele % l === 0 ? i : 0)),
                    ),
                  },
                };
              }),
            },
          },
        });
        mark?.();

        return { arrayBuffer: result.slice().buffer };
      },
      parentAbortController,
    );
    // maplibre transfers the buffer to its own worker, which would detach the
    // copy held in the cache, so give each caller its own
    return cached.then(({ arrayBuffer }) => ({
      arrayBuffer: copy(arrayBuffer),
    }));
  }

  /**
   * Detects orienteering landforms around a tile: small knolls, pits, depressions, earth banks and
   * cliffs (with tags), gullies, earth walls, form lines and broken ground. Needs a high resolution DEM.
<<<<<<< HEAD
   *
   * Detection is cached separately from the encoded tile, so changing only the tag spacing or
   * length does not repeat it.
=======
>>>>>>> cfd2be6413180125f177f5fbe7b6615f72f5cccb
   */
  fetchLandformTile(
    z: number,
    x: number,
    y: number,
    options: LandformTileOptions,
    parentAbortController: AbortController,
    timer?: Timer,
  ): Promise<ContourTile> {
    const resolved = resolveLandformOptions(options);
    const key = [z, x, y, "landforms", resolved.key].join("/");
    const cached = this.landformCache.get(
      key,
      async (_, childAbortController) => {
<<<<<<< HEAD
        const detectionKey = [
          z,
          x,
          y,
          "landform-detection",
          resolved.detectionKey,
        ].join("/");
        const found = await this.landformDetectionCache.get(
          detectionKey,
          (_, detectionAbortController) =>
            this.detectLandformsInTile(
              z,
              x,
              y,
              resolved,
              detectionAbortController,
              timer,
            ),
          childAbortController,
        );
        if (!found || isAborted(childAbortController)) {
          return { arrayBuffer: new Uint8Array().buffer };
        }
        const mark = timer?.marker("isoline");
=======
        const max = 1 << z;
        const neighborPromises: (Promise<HeightTile> | undefined)[] = [];
        for (let iy = y - 1; iy <= y + 1; iy++) {
          for (let ix = x - 1; ix <= x + 1; ix++) {
            neighborPromises.push(
              iy < 0 || iy >= max
                ? undefined
                : this.fetchDem(
                    z,
                    (ix + max) % max,
                    iy,
                    resolved,
                    childAbortController,
                    timer,
                  ),
            );
          }
        }
        const neighbors = await Promise.all(neighborPromises);
        const virtualTile = HeightTile.combineNeighbors(neighbors);
        if (!virtualTile || isAborted(childAbortController)) {
          return { arrayBuffer: new Uint8Array().buffer };
        }
        const { thresholds } = resolved;
        const ground = groundTileSize(z, y);
        // too coarse to see anything the size of an orienteering feature
        const sourceWidth = (neighbors[4] as HeightTile).width;
        if (ground / sourceWidth > thresholds.maxCellSize) {
          return { arrayBuffer: new Uint8Array().buffer };
        }
        const mark = timer?.marker("isoline");

        let factor = 1;
        while (virtualTile.width * factor < resolved.subsampleBelow) {
          factor *= 2;
        }
        const width = virtualTile.width * factor;
        const cell = ground / width;
        const margin = Math.min(landformMargin(thresholds, cell), width);
        const analysisTile = prepareAnalysisTile(
          virtualTile,
          resolved.subsampleBelow,
          margin,
        );
        const grid = Grid.fromHeightTile(analysisTile, margin, cell);
        const corners = resolved.groups.has("formLines")
          ? analysisTile.averagePixelCentersToGrid().materialize(1)
          : undefined;
        const found = detectLandforms(grid, resolved, corners);
        mark?.();

>>>>>>> cfd2be6413180125f177f5fbe7b6615f72f5cccb
        const result = encodeVectorTile({
          extent: resolved.extent,
          layers: {
            landform_points: { features: found.points },
            landform_lines: { features: found.lines },
<<<<<<< HEAD
            landform_ticks: {
              features: makeTicks(
                found.tickLines,
                resolved.extent,
                resolved.tickSpacing,
                resolved.tickLength,
              ),
            },
=======
            landform_ticks: { features: found.ticks },
>>>>>>> cfd2be6413180125f177f5fbe7b6615f72f5cccb
            landform_areas: { features: found.areas },
          },
        });
        mark?.();
        return { arrayBuffer: result.slice().buffer };
      },
      parentAbortController,
    );
    return cached.then(({ arrayBuffer }) => ({
      arrayBuffer: copy(arrayBuffer),
    }));
  }
<<<<<<< HEAD

  /** `undefined` when there is nothing to detect: no data, or a DEM too coarse to see landforms. */
  private async detectLandformsInTile(
    z: number,
    x: number,
    y: number,
    resolved: ResolvedLandformOptions,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<LandformResult | undefined> {
    const max = 1 << z;
    const neighborPromises: (Promise<HeightTile> | undefined)[] = [];
    for (let iy = y - 1; iy <= y + 1; iy++) {
      for (let ix = x - 1; ix <= x + 1; ix++) {
        neighborPromises.push(
          iy < 0 || iy >= max
            ? undefined
            : this.fetchDem(
                z,
                (ix + max) % max,
                iy,
                resolved,
                abortController,
                timer,
              ),
        );
      }
    }
    const neighbors = await Promise.all(neighborPromises);
    const virtualTile = HeightTile.combineNeighbors(neighbors);
    if (!virtualTile || isAborted(abortController)) return undefined;
    const { thresholds } = resolved;
    const ground = groundTileSize(z, y);
    // too coarse to see anything the size of an orienteering feature
    const sourceWidth = (neighbors[4] as HeightTile).width;
    if (ground / sourceWidth > thresholds.maxCellSize) return undefined;
    const mark = timer?.marker("isoline");

    let factor = 1;
    while (virtualTile.width * factor < resolved.subsampleBelow) factor *= 2;
    const width = virtualTile.width * factor;
    const cell = ground / width;
    const margin = Math.min(landformMargin(thresholds, cell), width);
    const analysisTile = prepareAnalysisTile(
      virtualTile,
      resolved.subsampleBelow,
      margin,
    );
    const grid = Grid.fromHeightTile(analysisTile, margin, cell);
    const corners = resolved.groups.has("formLines")
      ? analysisTile.averagePixelCentersToGrid().materialize(1)
      : undefined;
    const found = detectLandforms(grid, resolved, corners);
    mark?.();
    return found;
  }
=======
>>>>>>> cfd2be6413180125f177f5fbe7b6615f72f5cccb
}
