import type { ContourTile, LandformTileOptions, DemTile, GlobalContourTileOptions, IndividualContourTileOptions, TransferrableContourTile, TransferrableDemTile } from "./types";
export declare function encodeOptions({ thresholds, ...rest }: GlobalContourTileOptions): string;
export declare function decodeOptions(options: string): GlobalContourTileOptions;
/** Landform options are nested, so they travel in a single JSON query parameter. */
export declare function encodeLandformOptions(options: LandformTileOptions): string;
export declare function decodeLandformOptions(url: string): LandformTileOptions;
export declare function encodeIndividualOptions(options: IndividualContourTileOptions): string;
export declare function getOptionsForZoom(options: GlobalContourTileOptions, zoom: number): IndividualContourTileOptions;
export declare function copy(src: ArrayBuffer): ArrayBuffer;
export declare function prepareDemTile(promise: Promise<DemTile>, copy: boolean): Promise<TransferrableDemTile>;
export declare function prepareContourTile(promise: Promise<ContourTile>): Promise<TransferrableContourTile>;
export declare function offscreenCanvasSupported(): boolean;
export declare function shouldUseVideoFrame(): boolean;
export declare function withTimeout<T>(timeoutMs: number, value: Promise<T>, abortController?: AbortController, description?: string): Promise<T>;
export declare function onAbort(abortController?: AbortController, action?: () => void): void;
export declare function isAborted(abortController?: AbortController): boolean;
export declare function parseUrl(url: string): [number, number, number];
