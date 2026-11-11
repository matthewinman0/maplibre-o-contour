/* eslint-disable */

var shared, worker, mlcontour;
// define gets called three times: one for each chunk. we rely on the order
// they're imported to know which is which
function define(_, chunk) {
  if (!shared) {
    shared = chunk;
  } else if (!worker) {
    worker = chunk;
  } else {
    var workerBundleString =
      "var sharedChunk = {}; (" +
      shared +
      ")(sharedChunk); (" +
      worker +
      ")(sharedChunk);";

    var sharedChunk = {};
    shared(sharedChunk);
    mlcontour = chunk(sharedChunk);
    if (typeof window !== "undefined") {
      mlcontour.workerUrl = window.URL.createObjectURL(
        new Blob([workerBundleString], { type: "text/javascript" })
      );
    }
  }
}


define(['exports'], (function (exports) { 'use strict';

/*
Adapted from d3-contour https://github.com/d3/d3-contour

Copyright 2012-2023 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
*/
class Fragment {
    constructor(start, end) {
        this.start = start;
        this.end = end;
        this.points = [];
        this.append = this.append.bind(this);
        this.prepend = this.prepend.bind(this);
    }
    append(x, y) {
        this.points.push(Math.round(x), Math.round(y));
    }
    prepend(x, y) {
        this.points.splice(0, 0, Math.round(x), Math.round(y));
    }
    lineString() {
        return this.toArray();
    }
    isEmpty() {
        return this.points.length < 2;
    }
    appendFragment(other) {
        this.points.push(...other.points);
        this.end = other.end;
    }
    toArray() {
        return this.points;
    }
}
const CASES = [
    [],
    [
        [
            [1, 2],
            [0, 1],
        ],
    ],
    [
        [
            [2, 1],
            [1, 2],
        ],
    ],
    [
        [
            [2, 1],
            [0, 1],
        ],
    ],
    [
        [
            [1, 0],
            [2, 1],
        ],
    ],
    [
        [
            [1, 2],
            [0, 1],
        ],
        [
            [1, 0],
            [2, 1],
        ],
    ],
    [
        [
            [1, 0],
            [1, 2],
        ],
    ],
    [
        [
            [1, 0],
            [0, 1],
        ],
    ],
    [
        [
            [0, 1],
            [1, 0],
        ],
    ],
    [
        [
            [1, 2],
            [1, 0],
        ],
    ],
    [
        [
            [0, 1],
            [1, 0],
        ],
        [
            [2, 1],
            [1, 2],
        ],
    ],
    [
        [
            [2, 1],
            [1, 0],
        ],
    ],
    [
        [
            [0, 1],
            [2, 1],
        ],
    ],
    [
        [
            [1, 2],
            [2, 1],
        ],
    ],
    [
        [
            [0, 1],
            [1, 2],
        ],
    ],
    [],
];
function index(width, x, y, point) {
    x = x * 2 + point[0];
    y = y * 2 + point[1];
    return x + y * (width + 1) * 2;
}
function ratio(a, b, c) {
    return (b - a) / (c - a);
}
/**
 * Generates contour lines from a HeightTile
 *
 * @param interval Vertical distance between contours
 * @param tile The input height tile, where values represent the height at the top-left of each pixel
 * @param extent Vector tile extent (default 4096)
 * @param buffer How many pixels into each neighboring tile to include in a tile
 * @returns an object where keys are the elevation, and values are a list of `[x1, y1, x2, y2, ...]`
 * contour lines in tile coordinates
 */
function generateIsolines(interval, tile, extent = 4096, buffer = 1) {
    if (!interval) {
        return {};
    }
    const multiplier = extent / (tile.width - 1);
    let tld, trd, bld, brd;
    let r, c;
    const segments = {};
    const fragmentByStartByLevel = new Map();
    const fragmentByEndByLevel = new Map();
    function interpolate(point, threshold, accept) {
        if (point[0] === 0) {
            // left
            accept(multiplier * (c - 1), multiplier * (r - ratio(bld, threshold, tld)));
        }
        else if (point[0] === 2) {
            // right
            accept(multiplier * c, multiplier * (r - ratio(brd, threshold, trd)));
        }
        else if (point[1] === 0) {
            // top
            accept(multiplier * (c - ratio(trd, threshold, tld)), multiplier * (r - 1));
        }
        else {
            // bottom
            accept(multiplier * (c - ratio(brd, threshold, bld)), multiplier * r);
        }
    }
    // Most marching-squares implementations (d3-contour, gdal-contour) make one pass through the matrix per threshold.
    // This implementation makes a single pass through the matrix, building up all of the contour lines at the
    // same time to improve performance.
    for (r = 1 - buffer; r < tile.height + buffer; r++) {
        trd = tile.get(0, r - 1);
        brd = tile.get(0, r);
        let minR = Math.min(trd, brd);
        let maxR = Math.max(trd, brd);
        for (c = 1 - buffer; c < tile.width + buffer; c++) {
            tld = trd;
            bld = brd;
            trd = tile.get(c, r - 1);
            brd = tile.get(c, r);
            const minL = minR;
            const maxL = maxR;
            minR = Math.min(trd, brd);
            maxR = Math.max(trd, brd);
            if (isNaN(tld) || isNaN(trd) || isNaN(brd) || isNaN(bld)) {
                continue;
            }
            const min = Math.min(minL, minR);
            const max = Math.max(maxL, maxR);
            const start = Math.ceil(min / interval) * interval;
            const end = Math.floor(max / interval) * interval;
            for (let threshold = start; threshold <= end; threshold += interval) {
                const tl = tld > threshold;
                const tr = trd > threshold;
                const bl = bld > threshold;
                const br = brd > threshold;
                for (const segment of CASES[(tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)]) {
                    let fragmentByStart = fragmentByStartByLevel.get(threshold);
                    if (!fragmentByStart)
                        fragmentByStartByLevel.set(threshold, (fragmentByStart = new Map()));
                    let fragmentByEnd = fragmentByEndByLevel.get(threshold);
                    if (!fragmentByEnd)
                        fragmentByEndByLevel.set(threshold, (fragmentByEnd = new Map()));
                    const start = segment[0];
                    const end = segment[1];
                    const startIndex = index(tile.width, c, r, start);
                    const endIndex = index(tile.width, c, r, end);
                    let f, g;
                    if ((f = fragmentByEnd.get(startIndex))) {
                        fragmentByEnd.delete(startIndex);
                        if ((g = fragmentByStart.get(endIndex))) {
                            fragmentByStart.delete(endIndex);
                            if (f === g) {
                                // closing a ring
                                interpolate(end, threshold, f.append);
                                if (!f.isEmpty()) {
                                    let list = segments[threshold];
                                    if (!list) {
                                        segments[threshold] = list = [];
                                    }
                                    list.push(f.lineString());
                                }
                            }
                            else {
                                // connecting 2 segments
                                f.appendFragment(g);
                                fragmentByEnd.set((f.end = g.end), f);
                            }
                        }
                        else {
                            // adding to the end of f
                            interpolate(end, threshold, f.append);
                            fragmentByEnd.set((f.end = endIndex), f);
                        }
                    }
                    else if ((f = fragmentByStart.get(endIndex))) {
                        fragmentByStart.delete(endIndex);
                        // extending the start of f
                        interpolate(start, threshold, f.prepend);
                        fragmentByStart.set((f.start = startIndex), f);
                    }
                    else {
                        // starting a new fragment
                        const newFrag = new Fragment(startIndex, endIndex);
                        interpolate(start, threshold, newFrag.append);
                        interpolate(end, threshold, newFrag.append);
                        fragmentByStart.set(startIndex, newFrag);
                        fragmentByEnd.set(endIndex, newFrag);
                    }
                }
            }
        }
    }
    for (const [level, fragmentByStart] of fragmentByStartByLevel.entries()) {
        let list = null;
        for (const value of fragmentByStart.values()) {
            if (!value.isEmpty()) {
                if (list == null) {
                    list = segments[level] || (segments[level] = []);
                }
                list.push(value.lineString());
            }
        }
    }
    return segments;
}

/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise */


function __rest(s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
}

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

function sortedEntries(object) {
    const entries = Object.entries(object);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries;
}
function encodeThresholds(thresholds) {
    return sortedEntries(thresholds)
        .map(([key, value]) => [key, ...(typeof value === "number" ? [value] : value)].join("*"))
        .join("~");
}
function decodeThresholds(thresholds) {
    return Object.fromEntries(thresholds
        .split("~")
        .map((part) => part.split("*").map(Number))
        .map(([key, ...values]) => [key, values]));
}
function encodeOptions(_a) {
    var { thresholds } = _a, rest = __rest(_a, ["thresholds"]);
    return sortedEntries(Object.assign({ thresholds: encodeThresholds(thresholds) }, rest))
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
}
function decodeOptions(options) {
    return Object.fromEntries(options
        .replace(/^.*\?/, "")
        .split("&")
        .map((part) => {
        const parts = part.split("=").map(decodeURIComponent);
        const k = parts[0];
        let v = parts[1];
        switch (k) {
            case "thresholds":
                v = decodeThresholds(v);
                break;
            case "extent":
            case "multiplier":
            case "overzoom":
            case "buffer":
                v = Number(v);
        }
        return [k, v];
    }));
}
function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${sortedEntries(value)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
/** Landform options are nested, so they travel in a single JSON query parameter. */
function encodeLandformOptions(options) {
    return `o=${encodeURIComponent(stableStringify(options))}`;
}
function decodeLandformOptions(url) {
    const query = url.replace(/^[^?]*\??/, "");
    for (const part of query.split("&")) {
        if (part.startsWith("o=")) {
            return JSON.parse(decodeURIComponent(part.slice(2)));
        }
    }
    return {};
}
function encodeIndividualOptions(options) {
    return sortedEntries(options)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join(",");
}
function getOptionsForZoom(options, zoom) {
    const { thresholds } = options, rest = __rest(options, ["thresholds"]);
    let levels = [];
    let maxLessThanOrEqualTo = -Infinity;
    Object.entries(thresholds).forEach(([zString, value]) => {
        const z = Number(zString);
        if (z <= zoom && z > maxLessThanOrEqualTo) {
            maxLessThanOrEqualTo = z;
            levels = typeof value === "number" ? [value] : value;
        }
    });
    return Object.assign({ levels }, rest);
}
function copy(src) {
    const dst = new ArrayBuffer(src.byteLength);
    new Uint8Array(dst).set(new Uint8Array(src));
    return dst;
}
function prepareDemTile(promise, copy) {
    return promise.then((_a) => {
        var { data } = _a, rest = __rest(_a, ["data"]);
        let newData = data;
        if (copy) {
            newData = new Float32Array(data.length);
            newData.set(data);
        }
        return Object.assign(Object.assign({}, rest), { data: newData, transferrables: [newData.buffer] });
    });
}
function prepareContourTile(promise) {
    // LocalDemManager returns a fresh buffer each time, so it is safe to
    // transfer without copying again
    return promise.then(({ arrayBuffer }) => ({
        arrayBuffer,
        transferrables: [arrayBuffer],
    }));
}
let supportsOffscreenCanvas = null;
function offscreenCanvasSupported() {
    if (supportsOffscreenCanvas == null) {
        supportsOffscreenCanvas =
            typeof OffscreenCanvas !== "undefined" &&
                new OffscreenCanvas(1, 1).getContext("2d") &&
                typeof createImageBitmap === "function";
    }
    return supportsOffscreenCanvas || false;
}
let useVideoFrame = null;
function shouldUseVideoFrame() {
    if (useVideoFrame == null) {
        useVideoFrame = false;
        // if webcodec is supported, AND if the browser mangles getImageData results
        // (ie. safari with increased privacy protections) then use webcodec VideoFrame API
        if (offscreenCanvasSupported() && typeof VideoFrame !== "undefined") {
            const size = 5;
            const canvas = new OffscreenCanvas(5, 5);
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (context) {
                for (let i = 0; i < size * size; i++) {
                    const base = i * 4;
                    context.fillStyle = `rgb(${base},${base + 1},${base + 2})`;
                    context.fillRect(i % size, Math.floor(i / size), 1, 1);
                }
                const data = context.getImageData(0, 0, size, size).data;
                for (let i = 0; i < size * size * 4; i++) {
                    if (i % 4 !== 3 && data[i] !== i) {
                        useVideoFrame = true;
                        break;
                    }
                }
            }
        }
    }
    return useVideoFrame || false;
}
function withTimeout(timeoutMs, value, abortController, description) {
    let reject = () => { };
    const timeout = setTimeout(() => {
        reject(new Error(`${description ? `${description} ` : ""}timed out after ${timeoutMs}ms`));
        abortController === null || abortController === void 0 ? void 0 : abortController.abort();
    }, timeoutMs);
    onAbort(abortController, () => {
        reject(new Error("aborted"));
        clearTimeout(timeout);
    });
    const cancelPromise = new Promise((_, rej) => {
        reject = rej;
    });
    return Promise.race([
        cancelPromise,
        value.finally(() => clearTimeout(timeout)),
    ]);
}
function onAbort(abortController, action) {
    if (action) {
        abortController === null || abortController === void 0 ? void 0 : abortController.signal.addEventListener("abort", action);
    }
}
function isAborted(abortController) {
    var _a;
    return Boolean((_a = abortController === null || abortController === void 0 ? void 0 : abortController.signal) === null || _a === void 0 ? void 0 : _a.aborted);
}
function parseUrl(url) {
    const [, z, x, y] = /\/\/(\d+)\/(\d+)\/(\d+)/.exec(url) || [];
    return [Number(z), Number(x), Number(y)];
}

let num = 0;
/**
 * LRU Cache for CancelablePromises.
 * The underlying request is only canceled when all callers have canceled their usage of it.
 */
class AsyncCache {
    constructor(maxSize = 100) {
        this.size = () => this.items.size;
        this.get = (key, supplier, abortController) => {
            let result = this.items.get(key);
            if (!result) {
                const sharedAbortController = new AbortController();
                const value = supplier(key, sharedAbortController);
                result = {
                    abortController: sharedAbortController,
                    item: value,
                    lastUsed: ++num,
                    waiting: 1,
                };
                this.items.set(key, result);
                this.prune();
            }
            else {
                result.lastUsed = ++num;
                result.waiting++;
            }
            const items = this.items;
            const value = result.item.then((r) => r, (e) => {
                items.delete(key);
                return Promise.reject(e);
            });
            let canceled = false;
            onAbort(abortController, () => {
                var _a;
                if (result && result.abortController && !canceled) {
                    canceled = true;
                    if (--result.waiting <= 0) {
                        (_a = result.abortController) === null || _a === void 0 ? void 0 : _a.abort();
                        items.delete(key);
                    }
                }
            });
            return value;
        };
        this.clear = () => this.items.clear();
        this.maxSize = maxSize;
        this.items = new Map();
    }
    prune() {
        if (this.items.size > this.maxSize) {
            let minKey;
            let minUse = Infinity;
            this.items.forEach((value, key) => {
                if (value.lastUsed < minUse) {
                    minUse = value.lastUsed;
                    minKey = key;
                }
            });
            if (typeof minKey !== "undefined") {
                this.items.delete(minKey);
            }
        }
    }
}

let offscreenCanvas;
let offscreenContext;
let canvas;
let canvasContext;
/**
 * Parses a `raster-dem` image into a DemTile using Webcoded VideoFrame API.
 */
function decodeImageModern(blob, encoding, abortController) {
    return __awaiter(this, void 0, void 0, function* () {
        const img = yield createImageBitmap(blob);
        if (isAborted(abortController))
            return null;
        return decodeImageUsingOffscreenCanvas(img, encoding);
    });
}
function decodeImageUsingOffscreenCanvas(img, encoding) {
    if (!offscreenCanvas) {
        offscreenCanvas = new OffscreenCanvas(img.width, img.height);
        offscreenContext = offscreenCanvas.getContext("2d", {
            willReadFrequently: true,
        });
    }
    return getElevations(img, encoding, offscreenCanvas, offscreenContext);
}
/**
 * Parses a `raster-dem` image into a DemTile using webcodec VideoFrame API which works
 * even when browsers disable/degrade the canvas getImageData API as a privacy protection.
 */
function decodeImageVideoFrame(blob, encoding, abortController) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const img = yield createImageBitmap(blob);
        if (isAborted(abortController))
            return null;
        const vf = new VideoFrame(img, { timestamp: 0 });
        try {
            // formats we can handle: BGRX, BGRA, RGBA, RGBX
            const valid = ((_a = vf === null || vf === void 0 ? void 0 : vf.format) === null || _a === void 0 ? void 0 : _a.startsWith("BGR")) || ((_b = vf === null || vf === void 0 ? void 0 : vf.format) === null || _b === void 0 ? void 0 : _b.startsWith("RGB"));
            if (!valid) {
                throw new Error(`Unrecognized format: ${vf === null || vf === void 0 ? void 0 : vf.format}`);
            }
            const swapBR = (_c = vf === null || vf === void 0 ? void 0 : vf.format) === null || _c === void 0 ? void 0 : _c.startsWith("BGR");
            const size = vf.allocationSize();
            const data = new Uint8ClampedArray(size);
            yield vf.copyTo(data);
            if (swapBR) {
                for (let i = 0; i < data.length; i += 4) {
                    const tmp = data[i];
                    data[i] = data[i + 2];
                    data[i + 2] = tmp;
                }
            }
            return decodeParsedImage(img.width, img.height, encoding, data);
        }
        catch (_) {
            if (isAborted(abortController))
                return null;
            // fall back to offscreen canvas
            return decodeImageUsingOffscreenCanvas(img, encoding);
        }
        finally {
            vf.close();
        }
    });
}
/**
 * Parses a `raster-dem` image into a DemTile using `<img>` element drawn to a `<canvas>`.
 * Only works on the main thread, but works across all browsers.
 */
function decodeImageOld(blob, encoding, abortController) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!canvas) {
            canvas = document.createElement("canvas");
            canvasContext = canvas.getContext("2d", {
                willReadFrequently: true,
            });
        }
        const img = new Image();
        onAbort(abortController, () => (img.src = ""));
        const fetchedImage = yield new Promise((resolve, reject) => {
            img.onload = () => {
                if (!isAborted(abortController))
                    resolve(img);
                URL.revokeObjectURL(img.src);
                img.onload = null;
            };
            img.onerror = () => reject(new Error("Could not load image."));
            img.src = blob.size ? URL.createObjectURL(blob) : "";
        });
        return getElevations(fetchedImage, encoding, canvas, canvasContext);
    });
}
/**
 * Parses a `raster-dem` image in a worker that doesn't support OffscreenCanvas and createImageBitmap
 * by running decodeImageOld on the main thread and returning the result.
 */
function decodeImageOnMainThread(blob, encoding, abortController) {
    return self.actor.send("decodeImage", [], abortController, undefined, blob, encoding);
}
function isWorker() {
    return (
    // @ts-expect-error WorkerGlobalScope defined
    typeof WorkerGlobalScope !== "undefined" &&
        typeof self !== "undefined" &&
        // @ts-expect-error WorkerGlobalScope defined
        self instanceof WorkerGlobalScope);
}
const defaultDecoder = shouldUseVideoFrame()
    ? decodeImageVideoFrame
    : offscreenCanvasSupported()
        ? decodeImageModern
        : isWorker()
            ? decodeImageOnMainThread
            : decodeImageOld;
function getElevations(img, encoding, canvas, canvasContext) {
    canvas.width = img.width;
    canvas.height = img.height;
    if (!canvasContext)
        throw new Error("failed to get context");
    canvasContext.drawImage(img, 0, 0, img.width, img.height);
    const rgba = canvasContext.getImageData(0, 0, img.width, img.height).data;
    return decodeParsedImage(img.width, img.height, encoding, rgba);
}
function decodeParsedImage(width, height, encoding, input) {
    const decoder = encoding === "mapbox"
        ? (r, g, b) => -1e4 + (r * 256 * 256 + g * 256 + b) * 0.1
        : (r, g, b) => r * 256 + g + b / 256 - 32768;
    const data = new Float32Array(width * height);
    for (let i = 0; i < input.length; i += 4) {
        data[i / 4] = decoder(input[i], input[i + 1], input[i + 2]);
    }
    return { width, height, data };
}

const MIN_VALID_M = -12e3;
const MAX_VALID_M = 9000;
function defaultIsValid(number) {
    return !isNaN(number) && number >= MIN_VALID_M && number <= MAX_VALID_M;
}
/** A tile containing elevation values aligned to a grid. */
class HeightTile {
    constructor(width, height, get) {
        /**
         * Splits this tile into a `1<<subz` x `1<<subz` grid and returns the tile at coordinates `subx, suby`.
         */
        this.split = (subz, subx, suby) => {
            if (subz === 0)
                return this;
            const by = 1 << subz;
            const dx = (subx * this.width) / by;
            const dy = (suby * this.height) / by;
            return new HeightTile(this.width / by, this.height / by, (x, y) => this.get(x + dx, y + dy));
        };
        /**
         * Returns a new tile scaled up by `factor` with pixel values that are subsampled using
         * bilinear interpolation between the original height tile values.
         *
         * The original and result tile are assumed to represent values taken at the center of each pixel.
         */
        this.subsamplePixelCenters = (factor) => {
            const lerp = (a, b, f) => isNaN(a) ? b : isNaN(b) ? a : a + (b - a) * f;
            if (factor <= 1)
                return this;
            const sub = 0.5 - 1 / (2 * factor);
            const blerper = (x, y) => {
                const dx = x / factor - sub;
                const dy = y / factor - sub;
                const ox = Math.floor(dx);
                const oy = Math.floor(dy);
                const a = this.get(ox, oy);
                const b = this.get(ox + 1, oy);
                const c = this.get(ox, oy + 1);
                const d = this.get(ox + 1, oy + 1);
                const fx = dx - ox;
                const fy = dy - oy;
                const top = lerp(a, b, fx);
                const bottom = lerp(c, d, fx);
                return lerp(top, bottom, fy);
            };
            return new HeightTile(this.width * factor, this.height * factor, blerper);
        };
        /**
         * Assumes the input tile represented measurements taken at the center of each pixel, and
         * returns a new tile where values are the height at the top-left of each pixel by averaging
         * the 4 adjacent pixel values.
         */
        this.averagePixelCentersToGrid = (radius = 1) => new HeightTile(this.width + 1, this.height + 1, (x, y) => {
            let sum = 0, count = 0, v = 0;
            for (let newX = x - radius; newX < x + radius; newX++) {
                for (let newY = y - radius; newY < y + radius; newY++) {
                    if (!isNaN((v = this.get(newX, newY)))) {
                        count++;
                        sum += v;
                    }
                }
            }
            return count === 0 ? NaN : sum / count;
        });
        /** Returns a new tile with elevation values scaled by `multiplier`. */
        this.scaleElevation = (multiplier) => multiplier === 1
            ? this
            : new HeightTile(this.width, this.height, (x, y) => this.get(x, y) * multiplier);
        /**
         * Precompute every value from `-bufer, -buffer` to `width + buffer, height + buffer` and serve them
         * out of a `Float32Array`. Until this method is called, all `get` requests are lazy and call all previous
         * methods in the chain up to the root DEM tile.
         */
        this.materialize = (buffer = 2) => {
            const stride = this.width + 2 * buffer;
            const data = new Float32Array(stride * (this.height + 2 * buffer));
            let idx = 0;
            for (let y = -buffer; y < this.height + buffer; y++) {
                for (let x = -buffer; x < this.width + buffer; x++) {
                    data[idx++] = this.get(x, y);
                }
            }
            return new HeightTile(this.width, this.height, (x, y) => data[(y + buffer) * stride + x + buffer]);
        };
        this.get = get;
        this.width = width;
        this.height = height;
    }
    /** Construct a height tile from raw DEM pixel values */
    static fromRawDem(demTile) {
        return new HeightTile(demTile.width, demTile.height, (x, y) => {
            const value = demTile.data[y * demTile.width + x];
            return defaultIsValid(value) ? value : NaN;
        });
    }
    /**
     * Construct a height tile from a DEM tile plus it's 8 neighbors, so that
     * you can request `x` or `y` outside the bounds of the original tile.
     *
     * @param neighbors An array containing tiles: `[nw, n, ne, w, c, e, sw, s, se]`
     */
    static combineNeighbors(neighbors) {
        if (neighbors.length !== 9) {
            throw new Error("Must include a tile plus 8 neighbors");
        }
        const mainTile = neighbors[4];
        if (!mainTile) {
            return undefined;
        }
        const width = mainTile.width;
        const height = mainTile.height;
        return new HeightTile(width, height, (x, y) => {
            let gridIdx = 0;
            if (y < 0) {
                y += height;
            }
            else if (y < height) {
                gridIdx += 3;
            }
            else {
                y -= height;
                gridIdx += 6;
            }
            if (x < 0) {
                x += width;
            }
            else if (x < width) {
                gridIdx += 1;
            }
            else {
                x -= width;
                gridIdx += 2;
            }
            const grid = neighbors[gridIdx];
            return grid ? grid.get(x, y) : NaN;
        });
    }
}

/** Bilinear interpolation in a row-major raster, `NaN` when outside of it. */
function bilinear(data, width, height, fx, fy) {
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
class Grid {
    constructor(tileWidth, tileHeight, margin, cell, data) {
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
    static fromHeightTile(tile, margin, cell) {
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
    static fromFunction(tileWidth, tileHeight, margin, cell, fn) {
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
    sample(fx, fy) {
        return bilinear(this.data, this.width, this.height, fx, fy);
    }
}
/** Sobel gradient of the elevation window. The outermost ring of pixels is `NaN`. */
function computeGradient(grid) {
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
function boxMean(data, width, height, radius) {
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
            const s = sum[y1 * stride + x1] -
                sum[y0 * stride + x1] -
                sum[y1 * stride + x0] +
                sum[y0 * stride + x0];
            const c = count[y1 * stride + x1] -
                count[y0 * stride + x1] -
                count[y1 * stride + x0] +
                count[y0 * stride + x0];
            out[j * width + i] = c === 0 ? NaN : s / c;
        }
    }
    return out;
}

/**
 * Options and defaults for DEM-derived orienteering landform detection.
 *
 * Distances are metres, heights/depths are metres, slopes are degrees.
 * Where a default comes from the ISOM 2017-2 specification the symbol number is given.
 */
const ALL_LANDFORM_GROUPS = [
    "knolls",
    "depressions",
    "banks",
    "gullies",
    "walls",
    "formLines",
    "brokenGround",
    "boulders",
];
const DEFAULT_LANDFORM_GROUPS = ALL_LANDFORM_GROUPS.filter((g) => g !== "boulders");
const DEFAULT_LANDFORM_THRESHOLDS = {
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
function resolveLandformOptions(options = {}) {
    var _a, _b, _c, _d, _e, _f;
    const groups = new Set(options.features || DEFAULT_LANDFORM_GROUPS);
    const thresholds = Object.assign(Object.assign({}, DEFAULT_LANDFORM_THRESHOLDS), (options.thresholds || {}));
    const resolved = {
        extent: (_a = options.extent) !== null && _a !== void 0 ? _a : 4096,
        buffer: (_b = options.buffer) !== null && _b !== void 0 ? _b : 1,
        overzoom: (_c = options.overzoom) !== null && _c !== void 0 ? _c : 0,
        subsampleBelow: (_d = options.subsampleBelow) !== null && _d !== void 0 ? _d : 100,
        tickSpacing: (_e = options.tickSpacing) !== null && _e !== void 0 ? _e : 80,
        tickLength: (_f = options.tickLength) !== null && _f !== void 0 ? _f : 36,
    };
    const sortedGroups = [...groups].sort();
    const sortedThresholds = Object.fromEntries(Object.entries(thresholds).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return Object.assign(Object.assign({ groups,
        thresholds }, resolved), { key: JSON.stringify([sortedGroups, sortedThresholds, resolved]) });
}

/** Binary min-heap keyed by a number, carrying an integer payload. */
class MinHeap {
    constructor(capacity) {
        this.size = 0;
        this.topKey = 0;
        this.keys = new Float64Array(capacity);
        this.vals = new Int32Array(capacity);
    }
    push(key, val) {
        const { keys, vals } = this;
        let i = this.size++;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (keys[parent] <= key)
                break;
            keys[i] = keys[parent];
            vals[i] = vals[parent];
            i = parent;
        }
        keys[i] = key;
        vals[i] = val;
    }
    /** Removes the smallest entry, returns its payload and leaves its key in `topKey`. */
    pop() {
        const { keys, vals } = this;
        const result = vals[0];
        this.topKey = keys[0];
        const n = --this.size;
        if (n > 0) {
            const key = keys[n];
            const val = vals[n];
            let i = 0;
            for (;;) {
                let child = 2 * i + 1;
                if (child >= n)
                    break;
                if (child + 1 < n && keys[child + 1] < keys[child])
                    child++;
                if (keys[child] >= key)
                    break;
                keys[i] = keys[child];
                vals[i] = vals[child];
                i = child;
            }
            keys[i] = key;
            vals[i] = val;
        }
        return result;
    }
}
/**
 * Fills every depression in the raster up to the level at which water would spill out of it
 * (priority-flood, Barnes et al. 2014). Water can leave through the raster border or through
 * `NaN` pixels. Returns the filled surface, so `filled - data` is the depth of each depression.
 */
function priorityFlood(data, width, height) {
    const n = width * height;
    const filled = new Float32Array(data);
    const visited = new Uint8Array(n);
    const heap = new MinHeap(n);
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            const idx = j * width + i;
            const border = i === 0 || j === 0 || i === width - 1 || j === height - 1;
            if (isNaN(data[idx])) {
                visited[idx] = 1;
                heap.push(-Infinity, idx);
            }
            else if (border) {
                visited[idx] = 1;
                heap.push(data[idx], idx);
            }
        }
    }
    while (heap.size > 0) {
        const idx = heap.pop();
        const level = heap.topKey;
        const i = idx % width;
        const j = (idx - i) / width;
        for (let dj = -1; dj <= 1; dj++) {
            const nj = j + dj;
            if (nj < 0 || nj >= height)
                continue;
            for (let di = -1; di <= 1; di++) {
                const ni = i + di;
                if (ni < 0 || ni >= width || (di === 0 && dj === 0))
                    continue;
                const nidx = nj * width + ni;
                if (visited[nidx])
                    continue;
                visited[nidx] = 1;
                const v = data[nidx];
                const f = v > level ? v : level;
                filled[nidx] = f;
                heap.push(f, nidx);
            }
        }
    }
    return filled;
}
/** Labels 8-connected groups of set pixels with 1..count. */
function labelComponents(mask, width, height) {
    const labels = new Int32Array(width * height);
    const stack = new Int32Array(width * height);
    let count = 0;
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || labels[start])
            continue;
        count++;
        let sp = 0;
        stack[sp++] = start;
        labels[start] = count;
        while (sp > 0) {
            const idx = stack[--sp];
            const i = idx % width;
            const j = (idx - i) / width;
            for (let dj = -1; dj <= 1; dj++) {
                const nj = j + dj;
                if (nj < 0 || nj >= height)
                    continue;
                for (let di = -1; di <= 1; di++) {
                    const ni = i + di;
                    if (ni < 0 || ni >= width)
                        continue;
                    const nidx = nj * width + ni;
                    if (mask[nidx] && !labels[nidx]) {
                        labels[nidx] = count;
                        stack[sp++] = nidx;
                    }
                }
            }
        }
    }
    return { labels, count };
}
/** Zhang-Suen thinning: reduces blobs to one-pixel wide skeletons. Pixels on the raster border are cleared. */
function thin(mask, width, height) {
    const img = Uint8Array.from(mask);
    for (let i = 0; i < width; i++) {
        img[i] = 0;
        img[(height - 1) * width + i] = 0;
    }
    for (let j = 0; j < height; j++) {
        img[j * width] = 0;
        img[j * width + width - 1] = 0;
    }
    const remove = [];
    let changed = true;
    for (let iteration = 0; changed && iteration < 200; iteration++) {
        changed = false;
        for (let step = 0; step < 2; step++) {
            remove.length = 0;
            for (let j = 1; j < height - 1; j++) {
                for (let i = 1; i < width - 1; i++) {
                    const idx = j * width + i;
                    if (!img[idx])
                        continue;
                    const p2 = img[idx - width];
                    const p3 = img[idx - width + 1];
                    const p4 = img[idx + 1];
                    const p5 = img[idx + width + 1];
                    const p6 = img[idx + width];
                    const p7 = img[idx + width - 1];
                    const p8 = img[idx - 1];
                    const p9 = img[idx - width - 1];
                    const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                    if (b < 2 || b > 6)
                        continue;
                    let a = 0;
                    if (!p2 && p3)
                        a++;
                    if (!p3 && p4)
                        a++;
                    if (!p4 && p5)
                        a++;
                    if (!p5 && p6)
                        a++;
                    if (!p6 && p7)
                        a++;
                    if (!p7 && p8)
                        a++;
                    if (!p8 && p9)
                        a++;
                    if (!p9 && p2)
                        a++;
                    if (a !== 1)
                        continue;
                    if (step === 0) {
                        if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0)
                            continue;
                    }
                    else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0)
                        continue;
                    remove.push(idx);
                }
            }
            for (const idx of remove)
                img[idx] = 0;
            if (remove.length > 0)
                changed = true;
        }
    }
    return img;
}
/**
 * Walks a one-pixel skeleton and returns its branches as flat `[i0, j0, i1, j1, ...]` pixel
 * coordinates. Short side branches (`spurLength` pixels or fewer) that end in a free tip are
 * dropped, and branches that meet at a node with nothing else attached are joined.
 */
function traceSkeleton(skeleton, width, height, spurLength) {
    const n = width * height;
    const neighborsOf = (idx) => {
        const out = [];
        const i = idx % width;
        const j = (idx - i) / width;
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                if (di === 0 && dj === 0)
                    continue;
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= width || nj >= height)
                    continue;
                const nidx = nj * width + ni;
                if (skeleton[nidx])
                    out.push(nidx);
            }
        }
        return out;
    };
    const degree = new Uint8Array(n);
    for (let idx = 0; idx < n; idx++) {
        if (skeleton[idx])
            degree[idx] = neighborsOf(idx).length;
    }
    const usedEdges = new Set();
    const edgeKey = (a, b) => (a < b ? a * n + b : b * n + a);
    const walk = (start, first) => {
        const path = [start, first];
        usedEdges.add(edgeKey(start, first));
        let prev = start;
        let cur = first;
        while (degree[cur] === 2) {
            const nb = neighborsOf(cur);
            const next = nb[0] === prev ? nb[1] : nb[0];
            if (next === undefined || usedEdges.has(edgeKey(cur, next)))
                break;
            usedEdges.add(edgeKey(cur, next));
            path.push(next);
            prev = cur;
            cur = next;
        }
        return path;
    };
    let paths = [];
    const onPath = new Uint8Array(n);
    for (let idx = 0; idx < n; idx++) {
        if (!skeleton[idx] || degree[idx] === 2)
            continue;
        for (const nidx of neighborsOf(idx)) {
            if (usedEdges.has(edgeKey(idx, nidx)))
                continue;
            const path = walk(idx, nidx);
            for (const p of path)
                onPath[p] = 1;
            paths.push(path);
        }
    }
    // closed loops that have no node on them
    for (let idx = 0; idx < n; idx++) {
        if (!skeleton[idx] || onPath[idx] || degree[idx] !== 2)
            continue;
        const path = walk(idx, neighborsOf(idx)[0]);
        path.push(idx);
        for (const p of path)
            onPath[p] = 1;
        paths.push(path);
    }
    // drop short spurs that end in a free tip and attach to a junction
    if (spurLength > 0) {
        paths = paths.map((path) => {
            if (!path)
                return path;
            const a = degree[path[0]];
            const b = degree[path[path.length - 1]];
            const spur = (a === 1 && b >= 3) || (b === 1 && a >= 3);
            return spur && path.length - 1 <= spurLength ? null : path;
        });
    }
    // join branches that are the only two meeting at a node
    const ends = new Map();
    const addEnd = (node, pi) => {
        const list = ends.get(node);
        if (list)
            list.push(pi);
        else
            ends.set(node, [pi]);
    };
    paths.forEach((path, pi) => {
        if (!path)
            return;
        addEnd(path[0], pi);
        addEnd(path[path.length - 1], pi);
    });
    for (const [node, list] of ends) {
        if (list.length !== 2 || list[0] === list[1])
            continue;
        const [a, b] = list;
        const first = paths[a];
        const second = paths[b];
        if (first[0] === node)
            first.reverse();
        if (second[second.length - 1] === node)
            second.reverse();
        const farEnd = second[second.length - 1];
        paths[a] = first.concat(second.slice(1));
        paths[b] = null;
        // whatever was attached to the far end of the second branch is now attached to the joined one
        const farList = ends.get(farEnd);
        if (farList) {
            for (let k = 0; k < farList.length; k++) {
                if (farList[k] === b)
                    farList[k] = a;
            }
        }
    }
    const result = [];
    for (const path of paths) {
        if (!path || path.length < 2)
            continue;
        const flat = [];
        for (const idx of path) {
            const i = idx % width;
            flat.push(i, (idx - i) / width);
        }
        result.push(flat);
    }
    return result;
}
/** Three-point moving average of a flat polyline, keeping the end points fixed. */
function smoothPath(points, passes) {
    let current = points;
    const count = points.length / 2;
    if (count < 3)
        return points.slice();
    for (let pass = 0; pass < passes; pass++) {
        const next = current.slice();
        for (let k = 1; k < count - 1; k++) {
            next[2 * k] =
                (current[2 * k - 2] + current[2 * k] + current[2 * k + 2]) / 3;
            next[2 * k + 1] =
                (current[2 * k - 1] + current[2 * k + 1] + current[2 * k + 3]) / 3;
        }
        current = next;
    }
    return current;
}
/** Douglas-Peucker simplification of a flat polyline. */
function simplifyPath(points, tolerance) {
    const count = points.length / 2;
    if (count < 3 || tolerance <= 0)
        return points.slice();
    const keep = new Uint8Array(count);
    keep[0] = 1;
    keep[count - 1] = 1;
    const stack = [[0, count - 1]];
    while (stack.length > 0) {
        const [first, last] = stack.pop();
        const ax = points[2 * first];
        const ay = points[2 * first + 1];
        const dx = points[2 * last] - ax;
        const dy = points[2 * last + 1] - ay;
        const len = Math.hypot(dx, dy);
        let maxDist = 0;
        let maxIdx = -1;
        for (let k = first + 1; k < last; k++) {
            const px = points[2 * k] - ax;
            const py = points[2 * k + 1] - ay;
            const dist = len === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len;
            if (dist > maxDist) {
                maxDist = dist;
                maxIdx = k;
            }
        }
        if (maxIdx >= 0 && maxDist > tolerance) {
            keep[maxIdx] = 1;
            stack.push([first, maxIdx], [maxIdx, last]);
        }
    }
    const out = [];
    for (let k = 0; k < count; k++) {
        if (keep[k])
            out.push(points[2 * k], points[2 * k + 1]);
    }
    return out;
}
/** Length of a flat polyline. */
function pathLength(points) {
    let total = 0;
    for (let k = 2; k < points.length; k += 2) {
        total += Math.hypot(points[k] - points[k - 2], points[k + 1] - points[k - 1]);
    }
    return total;
}
/** Shoelace area of a flat ring (positive when clockwise on screen, with y pointing down). */
function signedArea(ring) {
    let sum = 0;
    const count = ring.length / 2;
    for (let k = 0; k < count; k++) {
        const l = (k + 1) % count;
        sum += ring[2 * k] * ring[2 * l + 1] - ring[2 * l] * ring[2 * k + 1];
    }
    return sum / 2;
}
/** Ray-casting point in ring test. */
function pointInRing(x, y, ring) {
    let inside = false;
    const count = ring.length / 2;
    for (let k = 0, l = count - 1; k < count; l = k++) {
        const xk = ring[2 * k];
        const yk = ring[2 * k + 1];
        const xl = ring[2 * l];
        const yl = ring[2 * l + 1];
        if (yk > y !== yl > y && x < ((xl - xk) * (y - yk)) / (yl - yk) + xk) {
            inside = !inside;
        }
    }
    return inside;
}
/**
 * Clips a flat polyline to a rectangle, interpolating new vertices where it crosses the edge.
 * A line that leaves and re-enters the rectangle becomes several pieces.
 */
function clipPolyline(points, minX, minY, maxX, maxY) {
    const pieces = [];
    let current = [];
    const flush = () => {
        if (current.length >= 4)
            pieces.push(current);
        current = [];
    };
    for (let k = 0; k + 3 < points.length; k += 2) {
        const x0 = points[k];
        const y0 = points[k + 1];
        const dx = points[k + 2] - x0;
        const dy = points[k + 3] - y0;
        // Liang-Barsky
        let t0 = 0;
        let t1 = 1;
        let inside = true;
        const p = [-dx, dx, -dy, dy];
        const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
        for (let e = 0; e < 4 && inside; e++) {
            if (p[e] === 0) {
                if (q[e] < 0)
                    inside = false;
            }
            else {
                const r = q[e] / p[e];
                if (p[e] < 0) {
                    if (r > t1)
                        inside = false;
                    else if (r > t0)
                        t0 = r;
                }
                else if (r < t0) {
                    inside = false;
                }
                else if (r < t1) {
                    t1 = r;
                }
            }
        }
        if (!inside) {
            flush();
            continue;
        }
        if (current.length === 0 || t0 > 0) {
            flush();
            current.push(x0 + dx * t0, y0 + dy * t0);
        }
        current.push(x0 + dx * t1, y0 + dy * t1);
        if (t1 < 1)
            flush();
    }
    flush();
    return pieces;
}
function median(values) {
    if (values.length === 0)
        return NaN;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function percentile(values, p) {
    if (values.length === 0)
        return NaN;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const SHIFT_LEFT_32 = (1 << 16) * (1 << 16);
const SHIFT_RIGHT_32 = 1 / SHIFT_LEFT_32;

// Threshold chosen based on both benchmarking and knowledge about browser string
// data structures (which currently switch structure types at 12 bytes or more)
const TEXT_DECODER_MIN_LENGTH = 12;
const utf8TextDecoder = typeof TextDecoder === 'undefined' ? null : new TextDecoder('utf-8');

const PBF_VARINT  = 0; // varint: int32, int64, uint32, uint64, sint32, sint64, bool, enum
const PBF_FIXED64 = 1; // 64-bit: double, fixed64, sfixed64
const PBF_BYTES   = 2; // length-delimited: string, bytes, embedded messages, packed repeated fields
const PBF_FIXED32 = 5; // 32-bit: float, fixed32, sfixed32

class Pbf {
    /**
     * @param {Uint8Array | ArrayBuffer} [buf]
     */
    constructor(buf = new Uint8Array(16)) {
        this.buf = ArrayBuffer.isView(buf) ? buf : new Uint8Array(buf);
        this.dataView = new DataView(this.buf.buffer);
        this.pos = 0;
        this.type = 0;
        this.length = this.buf.length;
    }

    // === READING =================================================================

    /**
     * @template T
     * @param {(tag: number, result: T, pbf: Pbf) => void} readField
     * @param {T} result
     * @param {number} [end]
     */
    readFields(readField, result, end = this.length) {
        while (this.pos < end) {
            const val = this.readVarint(),
                tag = val >> 3,
                startPos = this.pos;

            this.type = val & 0x7;
            readField(tag, result, this);

            if (this.pos === startPos) this.skip(val);
        }
        return result;
    }

    /**
     * @template T
     * @param {(tag: number, result: T, pbf: Pbf) => void} readField
     * @param {T} result
     */
    readMessage(readField, result) {
        return this.readFields(readField, result, this.readVarint() + this.pos);
    }

    readFixed32() {
        const val = this.dataView.getUint32(this.pos, true);
        this.pos += 4;
        return val;
    }

    readSFixed32() {
        const val = this.dataView.getInt32(this.pos, true);
        this.pos += 4;
        return val;
    }

    // 64-bit int handling is based on github.com/dpw/node-buffer-more-ints (MIT-licensed)

    readFixed64() {
        const val = this.dataView.getUint32(this.pos, true) + this.dataView.getUint32(this.pos + 4, true) * SHIFT_LEFT_32;
        this.pos += 8;
        return val;
    }

    readSFixed64() {
        const val = this.dataView.getUint32(this.pos, true) + this.dataView.getInt32(this.pos + 4, true) * SHIFT_LEFT_32;
        this.pos += 8;
        return val;
    }

    readFloat() {
        const val = this.dataView.getFloat32(this.pos, true);
        this.pos += 4;
        return val;
    }

    readDouble() {
        const val = this.dataView.getFloat64(this.pos, true);
        this.pos += 8;
        return val;
    }

    /**
     * @param {boolean} [isSigned]
     */
    readVarint(isSigned) {
        const buf = this.buf;
        let val, b;

        b = buf[this.pos++]; val  =  b & 0x7f;        if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 7;  if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 14; if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 21; if (b < 0x80) return val;
        b = buf[this.pos];   val |= (b & 0x0f) << 28;

        return readVarintRemainder(val, isSigned, this);
    }

    readVarint64() { // for compatibility with v2.0.1
        return this.readVarint(true);
    }

    readSVarint() {
        const num = this.readVarint();
        return num % 2 === 1 ? (num + 1) / -2 : num / 2; // zigzag encoding
    }

    readBoolean() {
        return Boolean(this.readVarint());
    }

    readString() {
        const end = this.readVarint() + this.pos;
        const pos = this.pos;
        this.pos = end;

        if (end - pos >= TEXT_DECODER_MIN_LENGTH && utf8TextDecoder) {
            // longer strings are fast with the built-in browser TextDecoder API
            return utf8TextDecoder.decode(this.buf.subarray(pos, end));
        }
        // short strings are fast with our custom implementation
        return readUtf8(this.buf, pos, end);
    }

    readBytes() {
        const end = this.readVarint() + this.pos,
            buffer = this.buf.subarray(this.pos, end);
        this.pos = end;
        return buffer;
    }

    // verbose for performance reasons; doesn't affect gzipped size

    /**
     * @param {number[]} [arr]
     * @param {boolean} [isSigned]
     */
    readPackedVarint(arr = [], isSigned) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readVarint(isSigned));
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedSVarint(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readSVarint());
        return arr;
    }
    /** @param {boolean[]} [arr] */
    readPackedBoolean(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readBoolean());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedFloat(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readFloat());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedDouble(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readDouble());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedFixed32(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readFixed32());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedSFixed32(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readSFixed32());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedFixed64(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readFixed64());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedSFixed64(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readSFixed64());
        return arr;
    }
    readPackedEnd() {
        return this.type === PBF_BYTES ? this.readVarint() + this.pos : this.pos + 1;
    }

    /** @param {number} val */
    skip(val) {
        const type = val & 0x7;
        if (type === PBF_VARINT) while (this.buf[this.pos++] > 0x7f) {}
        else if (type === PBF_BYTES) this.pos = this.readVarint() + this.pos;
        else if (type === PBF_FIXED32) this.pos += 4;
        else if (type === PBF_FIXED64) this.pos += 8;
        else throw new Error(`Unimplemented type: ${type}`);
    }

    // === WRITING =================================================================

    /**
     * @param {number} tag
     * @param {number} type
     */
    writeTag(tag, type) {
        this.writeVarint((tag << 3) | type);
    }

    /** @param {number} min */
    realloc(min) {
        let length = this.length || 16;

        while (length < this.pos + min) length *= 2;

        if (length !== this.length) {
            const buf = new Uint8Array(length);
            buf.set(this.buf);
            this.buf = buf;
            this.dataView = new DataView(buf.buffer);
            this.length = length;
        }
    }

    finish() {
        this.length = this.pos;
        this.pos = 0;
        return this.buf.subarray(0, this.length);
    }

    /** @param {number} val */
    writeFixed32(val) {
        this.realloc(4);
        this.dataView.setInt32(this.pos, val, true);
        this.pos += 4;
    }

    /** @param {number} val */
    writeSFixed32(val) {
        this.realloc(4);
        this.dataView.setInt32(this.pos, val, true);
        this.pos += 4;
    }

    /** @param {number} val */
    writeFixed64(val) {
        this.realloc(8);
        this.dataView.setInt32(this.pos, val & -1, true);
        this.dataView.setInt32(this.pos + 4, Math.floor(val * SHIFT_RIGHT_32), true);
        this.pos += 8;
    }

    /** @param {number} val */
    writeSFixed64(val) {
        this.realloc(8);
        this.dataView.setInt32(this.pos, val & -1, true);
        this.dataView.setInt32(this.pos + 4, Math.floor(val * SHIFT_RIGHT_32), true);
        this.pos += 8;
    }

    /** @param {number} val */
    writeVarint(val) {
        val = +val || 0;

        if (val > 0xfffffff || val < 0) {
            writeBigVarint(val, this);
            return;
        }

        this.realloc(4);

        this.buf[this.pos++] =           val & 0x7f  | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) return;
        this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) return;
        this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) return;
        this.buf[this.pos++] =   (val >>> 7) & 0x7f;
    }

    /** @param {number} val */
    writeSVarint(val) {
        this.writeVarint(val < 0 ? -val * 2 - 1 : val * 2);
    }

    /** @param {boolean} val */
    writeBoolean(val) {
        this.writeVarint(+val);
    }

    /** @param {string} str */
    writeString(str) {
        str = String(str);
        this.realloc(str.length * 4);

        this.pos++; // reserve 1 byte for short string length

        const startPos = this.pos;
        // write the string directly to the buffer and see how much was written
        this.pos = writeUtf8(this.buf, str, this.pos);
        const len = this.pos - startPos;

        if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

        // finally, write the message length in the reserved place and restore the position
        this.pos = startPos - 1;
        this.writeVarint(len);
        this.pos += len;
    }

    /** @param {number} val */
    writeFloat(val) {
        this.realloc(4);
        this.dataView.setFloat32(this.pos, val, true);
        this.pos += 4;
    }

    /** @param {number} val */
    writeDouble(val) {
        this.realloc(8);
        this.dataView.setFloat64(this.pos, val, true);
        this.pos += 8;
    }

    /** @param {Uint8Array} buffer */
    writeBytes(buffer) {
        const len = buffer.length;
        this.writeVarint(len);
        this.realloc(len);
        for (let i = 0; i < len; i++) this.buf[this.pos++] = buffer[i];
    }

    /**
     * @template T
     * @param {(obj: T, pbf: Pbf) => void} fn
     * @param {T} obj
     */
    writeRawMessage(fn, obj) {
        this.pos++; // reserve 1 byte for short message length

        // write the message directly to the buffer and see how much was written
        const startPos = this.pos;
        fn(obj, this);
        const len = this.pos - startPos;

        if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

        // finally, write the message length in the reserved place and restore the position
        this.pos = startPos - 1;
        this.writeVarint(len);
        this.pos += len;
    }

    /**
     * @template T
     * @param {number} tag
     * @param {(obj: T, pbf: Pbf) => void} fn
     * @param {T} obj
     */
    writeMessage(tag, fn, obj) {
        this.writeTag(tag, PBF_BYTES);
        this.writeRawMessage(fn, obj);
    }

    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedVarint(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedVarint, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedSVarint(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedSVarint, arr);
    }
    /**
     * @param {number} tag
     * @param {boolean[]} arr
     */
    writePackedBoolean(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedBoolean, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedFloat(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedFloat, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedDouble(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedDouble, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedFixed32(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedFixed32, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedSFixed32(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedSFixed32, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedFixed64(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedFixed64, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedSFixed64(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedSFixed64, arr);
    }

    /**
     * @param {number} tag
     * @param {Uint8Array} buffer
     */
    writeBytesField(tag, buffer) {
        this.writeTag(tag, PBF_BYTES);
        this.writeBytes(buffer);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeFixed32Field(tag, val) {
        this.writeTag(tag, PBF_FIXED32);
        this.writeFixed32(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeSFixed32Field(tag, val) {
        this.writeTag(tag, PBF_FIXED32);
        this.writeSFixed32(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeFixed64Field(tag, val) {
        this.writeTag(tag, PBF_FIXED64);
        this.writeFixed64(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeSFixed64Field(tag, val) {
        this.writeTag(tag, PBF_FIXED64);
        this.writeSFixed64(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeVarintField(tag, val) {
        this.writeTag(tag, PBF_VARINT);
        this.writeVarint(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeSVarintField(tag, val) {
        this.writeTag(tag, PBF_VARINT);
        this.writeSVarint(val);
    }
    /**
     * @param {number} tag
     * @param {string} str
     */
    writeStringField(tag, str) {
        this.writeTag(tag, PBF_BYTES);
        this.writeString(str);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeFloatField(tag, val) {
        this.writeTag(tag, PBF_FIXED32);
        this.writeFloat(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeDoubleField(tag, val) {
        this.writeTag(tag, PBF_FIXED64);
        this.writeDouble(val);
    }
    /**
     * @param {number} tag
     * @param {boolean} val
     */
    writeBooleanField(tag, val) {
        this.writeVarintField(tag, +val);
    }
}
/**
 * @param {number} l
 * @param {boolean | undefined} s
 * @param {Pbf} p
 */
function readVarintRemainder(l, s, p) {
    const buf = p.buf;
    let h, b;

    b = buf[p.pos++]; h  = (b & 0x70) >> 4;  if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 3;  if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 10; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 17; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 24; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x01) << 31; if (b < 0x80) return toNum(l, h, s);

    throw new Error('Expected varint not more than 10 bytes');
}

/**
 * @param {number} low
 * @param {number} high
 * @param {boolean} [isSigned]
 */
function toNum(low, high, isSigned) {
    return isSigned ? high * 0x100000000 + (low >>> 0) : ((high >>> 0) * 0x100000000) + (low >>> 0);
}

/**
 * @param {number} val
 * @param {Pbf} pbf
 */
function writeBigVarint(val, pbf) {
    let low, high;

    if (val >= 0) {
        low  = (val % 0x100000000) | 0;
        high = (val / 0x100000000) | 0;
    } else {
        low  = ~(-val % 0x100000000);
        high = ~(-val / 0x100000000);

        if (low ^ 0xffffffff) {
            low = (low + 1) | 0;
        } else {
            low = 0;
            high = (high + 1) | 0;
        }
    }

    if (val >= 0x10000000000000000 || val < -18446744073709552e3) {
        throw new Error('Given varint doesn\'t fit into 10 bytes');
    }

    pbf.realloc(10);

    writeBigVarintLow(low, high, pbf);
    writeBigVarintHigh(high, pbf);
}

/**
 * @param {number} high
 * @param {number} low
 * @param {Pbf} pbf
 */
function writeBigVarintLow(low, high, pbf) {
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos]   = low & 0x7f;
}

/**
 * @param {number} high
 * @param {Pbf} pbf
 */
function writeBigVarintHigh(high, pbf) {
    const lsb = (high & 0x07) << 4;

    pbf.buf[pbf.pos++] |= lsb         | ((high >>>= 3) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f;
}

/**
 * @param {number} startPos
 * @param {number} len
 * @param {Pbf} pbf
 */
function makeRoomForExtraLength(startPos, len, pbf) {
    const extraLen =
        len <= 0x3fff ? 1 :
        len <= 0x1fffff ? 2 :
        len <= 0xfffffff ? 3 : Math.floor(Math.log(len) / (Math.LN2 * 7));

    // if 1 byte isn't enough for encoding message length, shift the data to the right
    pbf.realloc(extraLen);
    for (let i = pbf.pos - 1; i >= startPos; i--) pbf.buf[i + extraLen] = pbf.buf[i];
}

/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedVarint(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeVarint(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedSVarint(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeSVarint(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedFloat(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeFloat(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedDouble(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeDouble(arr[i]);
}
/**
 * @param {boolean[]} arr
 * @param {Pbf} pbf
 */
function writePackedBoolean(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeBoolean(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedFixed32(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeFixed32(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedSFixed32(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeSFixed32(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedFixed64(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeFixed64(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedSFixed64(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeSFixed64(arr[i]);
}

// Buffer code below from https://github.com/feross/buffer, MIT-licensed

/**
 * @param {Uint8Array} buf
 * @param {number} pos
 * @param {number} end
 */
function readUtf8(buf, pos, end) {
    let str = '';
    let i = pos;

    while (i < end) {
        const b0 = buf[i];
        let c = null; // codepoint
        let bytesPerSequence =
            b0 > 0xEF ? 4 :
            b0 > 0xDF ? 3 :
            b0 > 0xBF ? 2 : 1;

        if (i + bytesPerSequence > end) break;

        let b1, b2, b3;

        if (bytesPerSequence === 1) {
            if (b0 < 0x80) {
                c = b0;
            }
        } else if (bytesPerSequence === 2) {
            b1 = buf[i + 1];
            if ((b1 & 0xC0) === 0x80) {
                c = (b0 & 0x1F) << 0x6 | (b1 & 0x3F);
                if (c <= 0x7F) {
                    c = null;
                }
            }
        } else if (bytesPerSequence === 3) {
            b1 = buf[i + 1];
            b2 = buf[i + 2];
            if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80) {
                c = (b0 & 0xF) << 0xC | (b1 & 0x3F) << 0x6 | (b2 & 0x3F);
                if (c <= 0x7FF || (c >= 0xD800 && c <= 0xDFFF)) {
                    c = null;
                }
            }
        } else if (bytesPerSequence === 4) {
            b1 = buf[i + 1];
            b2 = buf[i + 2];
            b3 = buf[i + 3];
            if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80 && (b3 & 0xC0) === 0x80) {
                c = (b0 & 0xF) << 0x12 | (b1 & 0x3F) << 0xC | (b2 & 0x3F) << 0x6 | (b3 & 0x3F);
                if (c <= 0xFFFF || c >= 0x110000) {
                    c = null;
                }
            }
        }

        if (c === null) {
            c = 0xFFFD;
            bytesPerSequence = 1;

        } else if (c > 0xFFFF) {
            c -= 0x10000;
            str += String.fromCharCode(c >>> 10 & 0x3FF | 0xD800);
            c = 0xDC00 | c & 0x3FF;
        }

        str += String.fromCharCode(c);
        i += bytesPerSequence;
    }

    return str;
}

/**
 * @param {Uint8Array} buf
 * @param {string} str
 * @param {number} pos
 */
function writeUtf8(buf, str, pos) {
    for (let i = 0, c, lead; i < str.length; i++) {
        c = str.charCodeAt(i); // code point

        if (c > 0xD7FF && c < 0xE000) {
            if (lead) {
                if (c < 0xDC00) {
                    buf[pos++] = 0xEF;
                    buf[pos++] = 0xBF;
                    buf[pos++] = 0xBD;
                    lead = c;
                    continue;
                } else {
                    c = lead - 0xD800 << 10 | c - 0xDC00 | 0x10000;
                    lead = null;
                }
            } else {
                if (c > 0xDBFF || (i + 1 === str.length)) {
                    buf[pos++] = 0xEF;
                    buf[pos++] = 0xBF;
                    buf[pos++] = 0xBD;
                } else {
                    lead = c;
                }
                continue;
            }
        } else if (lead) {
            buf[pos++] = 0xEF;
            buf[pos++] = 0xBF;
            buf[pos++] = 0xBD;
            lead = null;
        }

        if (c < 0x80) {
            buf[pos++] = c;
        } else {
            if (c < 0x800) {
                buf[pos++] = c >> 0x6 | 0xC0;
            } else {
                if (c < 0x10000) {
                    buf[pos++] = c >> 0xC | 0xE0;
                } else {
                    buf[pos++] = c >> 0x12 | 0xF0;
                    buf[pos++] = c >> 0xC & 0x3F | 0x80;
                }
                buf[pos++] = c >> 0x6 & 0x3F | 0x80;
            }
            buf[pos++] = c & 0x3F | 0x80;
        }
    }
    return pos;
}

/*
Adapted from vt-pbf https://github.com/mapbox/vt-pbf

The MIT License (MIT)

Copyright (c) 2015 Anand Thakker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
var GeomType;
(function (GeomType) {
    GeomType[GeomType["UNKNOWN"] = 0] = "UNKNOWN";
    GeomType[GeomType["POINT"] = 1] = "POINT";
    GeomType[GeomType["LINESTRING"] = 2] = "LINESTRING";
    GeomType[GeomType["POLYGON"] = 3] = "POLYGON";
})(GeomType || (GeomType = {}));
/**
 * Enodes and serializes a mapbox vector tile as an array of bytes.
 */
function encodeVectorTile(tile) {
    const pbf = new Pbf();
    for (const id in tile.layers) {
        const layer = tile.layers[id];
        if (!layer.extent) {
            layer.extent = tile.extent;
        }
        pbf.writeMessage(3, writeLayer, Object.assign(Object.assign({}, layer), { id }));
    }
    return pbf.finish();
}
function writeLayer(layer, pbf) {
    if (!pbf)
        throw new Error("pbf undefined");
    pbf.writeStringField(1, layer.id || ""); // name (required, field 1)
    // Write all features (field 2)
    const context = {
        keys: [],
        values: [],
        keycache: {},
        valuecache: {},
    };
    for (const feature of layer.features) {
        context.feature = feature;
        pbf.writeMessage(2, writeFeature, context);
    }
    // Write all keys (field 3)
    for (const key of context.keys) {
        pbf.writeStringField(3, key);
    }
    // Write all values (field 4)
    for (const value of context.values) {
        pbf.writeMessage(4, writeValue, value);
    }
    pbf.writeVarintField(5, layer.extent || 4096); // extent (field 5)
    pbf.writeVarintField(15, 2); // version (field 15, LAST)
}
function writeFeature(context, pbf) {
    const feature = context.feature;
    if (!feature || !pbf)
        throw new Error();
    pbf.writeMessage(2, writeProperties, context);
    pbf.writeVarintField(3, feature.type);
    pbf.writeMessage(4, writeGeometry, feature);
}
function writeProperties(context, pbf) {
    const feature = context.feature;
    if (!feature || !pbf)
        throw new Error();
    const keys = context.keys;
    const values = context.values;
    const keycache = context.keycache;
    const valuecache = context.valuecache;
    for (const key in feature.properties) {
        let value = feature.properties[key];
        let keyIndex = keycache[key];
        if (value === null)
            continue; // don't encode null value properties
        if (typeof keyIndex === "undefined") {
            keys.push(key);
            keyIndex = keys.length - 1;
            keycache[key] = keyIndex;
        }
        pbf.writeVarint(keyIndex);
        const type = typeof value;
        if (type !== "string" && type !== "boolean" && type !== "number") {
            value = JSON.stringify(value);
        }
        const valueKey = `${type}:${value}`;
        let valueIndex = valuecache[valueKey];
        if (typeof valueIndex === "undefined") {
            values.push(value);
            valueIndex = values.length - 1;
            valuecache[valueKey] = valueIndex;
        }
        pbf.writeVarint(valueIndex);
    }
}
function command(cmd, length) {
    return (length << 3) + (cmd & 0x7);
}
function zigzag(num) {
    return (num << 1) ^ (num >> 31);
}
function writeGeometry(feature, pbf) {
    if (!pbf)
        throw new Error();
    const geometry = feature.geometry;
    const type = feature.type;
    let x = 0;
    let y = 0;
    for (const ring of geometry) {
        let count = 1;
        if (type === GeomType.POINT) {
            count = ring.length / 2;
        }
        pbf.writeVarint(command(1, count)); // moveto
        // do not write polygon closing path as lineto
        const length = ring.length / 2;
        const lineCount = type === GeomType.POLYGON ? length - 1 : length;
        for (let i = 0; i < lineCount; i++) {
            if (i === 1 && type !== 1) {
                pbf.writeVarint(command(2, lineCount - 1)); // lineto
            }
            const dx = ring[i * 2] - x;
            const dy = ring[i * 2 + 1] - y;
            pbf.writeVarint(zigzag(dx));
            pbf.writeVarint(zigzag(dy));
            x += dx;
            y += dy;
        }
        if (type === GeomType.POLYGON) {
            pbf.writeVarint(command(7, 1)); // closepath
        }
    }
}
function writeValue(value, pbf) {
    if (!pbf)
        throw new Error();
    if (typeof value === "string") {
        pbf.writeStringField(1, value);
    }
    else if (typeof value === "boolean") {
        pbf.writeBooleanField(7, value);
    }
    else if (typeof value === "number") {
        if (value % 1 !== 0) {
            pbf.writeDoubleField(3, value);
        }
        else if (value < 0) {
            pbf.writeSVarintField(6, value);
        }
        else {
            pbf.writeVarintField(5, value);
        }
    }
}

/** Sub-pixel precision used when asking the marching squares code for lines. */
const SUBPIXEL = 64;
const RAD = Math.PI / 180;
const round1 = (v) => Math.round(v * 10) / 10;
/** Whether a contour line at a multiple of `interval` passes through the height range. */
function crossesContour(low, high, interval) {
    return (interval > 0 && Math.floor(high / interval) > Math.floor(low / interval));
}
/** Converts window pixel coordinates of a flat polyline to tile units. */
function toTileUnits(ctx, points) {
    const out = new Array(points.length);
    for (let k = 0; k < points.length; k += 2) {
        out[k] = ctx.toX(points[k]);
        out[k + 1] = ctx.toY(points[k + 1]);
    }
    return out;
}
function roundPath(points) {
    return points.map(Math.round);
}
function reverseRing(ring) {
    const out = [];
    for (let k = ring.length - 2; k >= 0; k -= 2)
        out.push(ring[k], ring[k + 1]);
    return out;
}
function lineFeatures(ctx, tilePoints, properties, out) {
    const b = ctx.bufferUnits;
    for (const piece of clipPolyline(tilePoints, -b, -b, ctx.extent + b, ctx.extent + b)) {
        out.push({
            type: GeomType.LINESTRING,
            geometry: [roundPath(piece)],
            properties,
        });
    }
}
/** Short tags, perpendicular to the line and on its left, spaced along it. */
function addTicks(ctx, tilePoints, properties, out) {
    const { tickSpacing, tickLength } = ctx.o;
    if (tickSpacing <= 0 || tickLength <= 0)
        return;
    let next = tickSpacing / 2;
    let travelled = 0;
    for (let k = 2; k < tilePoints.length; k += 2) {
        const x0 = tilePoints[k - 2];
        const y0 = tilePoints[k - 1];
        const dx = tilePoints[k] - x0;
        const dy = tilePoints[k + 1] - y0;
        const len = Math.hypot(dx, dy);
        if (len === 0)
            continue;
        while (next <= travelled + len) {
            const f = (next - travelled) / len;
            const x = x0 + dx * f;
            const y = y0 + dy * f;
            if (x >= 0 && y >= 0 && x <= ctx.extent && y <= ctx.extent) {
                out.push({
                    type: GeomType.LINESTRING,
                    geometry: [
                        roundPath([
                            x,
                            y,
                            x + (dy / len) * tickLength,
                            y - (dx / len) * tickLength,
                        ]),
                    ],
                    properties,
                });
            }
            next += tickSpacing;
        }
        travelled += len;
    }
}
/**
 * Labels the pixels where `depth >= labelDepth` and describes each blob whose deepest point
 * is at least `minDepth`, whose centroid lies in the tile, and that is not cut off by the window edge.
 */
function findBlobs(ctx, depth, labelDepth, minDepth) {
    const { grid, grad, t } = ctx;
    const { width: w, height: h, margin } = grid;
    const mask = new Uint8Array(w * h);
    for (let k = 0; k < mask.length; k++) {
        if (depth[k] >= labelDepth)
            mask[k] = 1;
    }
    const { labels, count } = labelComponents(mask, w, h);
    if (count === 0)
        return [];
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
            if (!l)
                continue;
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
            if (i <= 1 ||
                j <= 1 ||
                i >= w - 2 ||
                j >= h - 2 ||
                isNaN(grad.mag[idx])) {
                bad[l] = 1;
            }
        }
    }
    const blobs = new Map();
    for (let l = 1; l <= count; l++) {
        if (bad[l] || n[l] < t.minCells || maxD[l] < minDepth)
            continue;
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
        const bearing = (Math.atan2(Math.cos(theta), -Math.sin(theta)) / RAD + 180) % 180;
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
    const slopes = new Map();
    blobs.forEach((_, l) => slopes.set(l, []));
    for (let idx = 0; idx < labels.length; idx++) {
        const list = slopes.get(labels[idx]);
        if (list && !isNaN(grad.mag[idx]))
            list.push(grad.mag[idx]);
    }
    slopes.forEach((list, l) => {
        blobs.get(l).wallSlope = Math.atan(percentile(list, 0.9)) / RAD;
    });
    return [...blobs.values()];
}
function pointFeature(ctx, cx, cy, properties) {
    return {
        type: GeomType.POINT,
        geometry: [[Math.round(ctx.toX(cx)), Math.round(ctx.toY(cy))]],
        properties,
    };
}
/** Small knolls (109, 110), boulders (204, 205), small depressions (111) and pits (112). */
function detectBlobFeatures(ctx, out) {
    const { grid, t, o } = ctx;
    const data = grid.data;
    const knolls = o.groups.has("knolls");
    const boulders = o.groups.has("boulders");
    if (knolls || boulders) {
        // a mound is a depression of the upside-down terrain: flood that to find how high it stands
        const inverted = data.map((v) => -v);
        const filled = priorityFlood(inverted, grid.width, grid.height);
        const height = filled.map((v, k) => v - inverted[k]);
        const minHeight = Math.min(knolls ? t.knollMinHeight : Infinity, boulders ? t.boulderMinHeight : Infinity);
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
            if (boulders &&
                blob.maxDepth >= t.boulderMinHeight &&
                blob.length <= t.boulderMaxLength &&
                // too small for a gradient to be measured, so use the average slope from the top to the edge
                Math.atan(blob.maxDepth / (blob.length / 2)) / RAD >=
                    t.boulderMinWallSlope) {
                const large = blob.maxDepth >= t.largeBoulderMinHeight;
                out.points.push(pointFeature(ctx, blob.cx, blob.cy, Object.assign(Object.assign({}, common), { kind: large ? "large_boulder" : "boulder", isom: large ? 205 : 204 })));
                continue;
            }
            if (!knolls ||
                blob.maxDepth < t.knollMinHeight ||
                blob.length > t.knollMaxLength) {
                continue;
            }
            const elongated = blob.length / blob.width >= t.elongationRatio;
            out.points.push(pointFeature(ctx, blob.cx, blob.cy, Object.assign(Object.assign({}, common), { kind: elongated ? "elongated_knoll" : "knoll", isom: elongated ? 110 : 109, orient: Math.round(blob.orient), small: !(blob.length >= t.contourKnollLength &&
                    blob.width >= t.contourKnollWidth) })));
        }
    }
    if (o.groups.has("depressions")) {
        const filled = priorityFlood(data, grid.width, grid.height);
        const depth = filled.map((v, k) => v - data[k]);
        const minDepth = Math.min(t.pitMinDepth, t.depressionMinDepth);
        for (const blob of findBlobs(ctx, depth, minDepth * 0.5, minDepth)) {
            if (blob.length > t.depressionMaxLength)
                continue;
            const bottom = data[blob.arg];
            const common = {
                ele: round1(bottom),
                depth: round1(blob.maxDepth),
                length: round1(blob.length),
                width: round1(blob.width),
                contoured: crossesContour(bottom, bottom + blob.maxDepth, t.contourInterval),
            };
            if (blob.maxDepth >= t.pitMinDepth &&
                blob.width >= t.pitMinWidth &&
                blob.length <= t.pitMaxLength &&
                blob.wallSlope >= t.pitMinWallSlope) {
                out.points.push(pointFeature(ctx, blob.cx, blob.cy, Object.assign(Object.assign({}, common), { kind: "pit", isom: 112, slope: Math.round(blob.wallSlope) })));
            }
            else if (blob.maxDepth >= t.depressionMinDepth &&
                blob.width >= t.depressionMinWidth) {
                out.points.push(pointFeature(ctx, blob.cx, blob.cy, Object.assign(Object.assign({}, common), { kind: "depression", isom: 111, orient: Math.round(blob.orient), small: !(blob.length >= t.contourDepressionLength &&
                        blob.width >= t.contourDepressionWidth) })));
            }
        }
    }
}
/** Earth banks (104), cliffs (202) and impassable cliffs (201): steep edges with their tags pointing downhill. */
function detectBanks(ctx, out) {
    const { grid, grad, t } = ctx;
    const { width: w, height: h, margin: m, cell } = grid;
    const steep = Math.tan(t.steepSlope * RAD);
    // the outline of the steep ground, with the steep side on the left of the direction of travel
    const field = new HeightTile(grid.tileWidth, grid.tileHeight, (x, y) => {
        const i = x + m;
        const j = y + m;
        return i < 0 || j < 0 || i >= w || j >= h
            ? NaN
            : grad.mag[j * w + i] / steep;
    });
    const fragments = generateIsolines(1, field, (grid.tileWidth - 1) * SUBPIXEL, m)[1] || [];
    for (const fragment of fragments) {
        const n = fragment.length / 2;
        if (n < 4)
            continue;
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
            if (len === 0)
                continue;
            const nx = ty / len;
            const ny = -tx / len;
            // only the top edge gets tags: the steep ground has to fall away from it
            const above = grid.sample(px[k] - nx * 1.5, py[k] - ny * 1.5);
            const below = grid.sample(px[k] + nx * 1.5, py[k] + ny * 1.5);
            const top = grid.sample(px[k], py[k]);
            if (!(below < above) || isNaN(top))
                continue;
            let maxMag = 0;
            let foot = top;
            let inside = false;
            for (let u = 0.5; u <= t.cliffScanDistance / cell; u += 0.5) {
                const fx = px[k] + nx * u;
                const fy = py[k] + ny * u;
                const z = grid.sample(fx, fy);
                const mag = bilinear(grad.mag, w, h, fx, fy);
                if (isNaN(z) || isNaN(mag))
                    break;
                maxMag = Math.max(maxMag, mag);
                foot = z;
                if (mag >= steep * 0.9)
                    inside = true;
                else if (inside && mag < steep * 0.6)
                    break;
            }
            heights[k] = top - foot;
            slopes[k] = Math.atan(maxMag) / RAD;
            good[k] = heights[k] >= t.bankMinHeight ? 1 : 0;
        }
        // bridge gaps of a couple of vertices
        for (let k = 1; k < n; k++) {
            if (good[k])
                continue;
            let end = k;
            while (end < n && !good[end])
                end++;
            if (end < n && good[k - 1] && end - k <= 2)
                good.fill(1, k, end);
            k = end;
        }
        for (let start = 0; start < n; start++) {
            if (!good[start])
                continue;
            let end = start;
            while (end + 1 < n && good[end + 1])
                end++;
            const run = end - start + 1;
            const first = start;
            start = end;
            if (run < 3)
                continue;
            const flat = [];
            for (let k = first; k <= end; k++)
                flat.push(px[k], py[k]);
            const smooth = smoothPath(flat, 2);
            if (pathLength(smooth) * cell < t.bankMinLength)
                continue;
            const height = median(Array.from(heights.slice(first, end + 1)));
            const slope = median(Array.from(slopes.slice(first, end + 1)));
            let kind = "bank";
            let isom = 104;
            if (height >= t.impassableMinHeight && slope >= t.impassableSlope) {
                kind = "impassable_cliff";
                isom = 201;
            }
            else if (slope >= t.cliffSlope) {
                kind = "cliff";
                isom = 202;
            }
            const tilePoints = toTileUnits(ctx, smooth);
            const properties = { kind, isom };
            lineFeatures(ctx, tilePoints, Object.assign(Object.assign({}, properties), { height: round1(height), slope: Math.round(slope) }), out.lines);
            addTicks(ctx, tilePoints, properties, out.ticks);
        }
    }
}
/**
 * Finds narrow, elongated runs of pixels where `relief >= threshold`, reduces them to centre
 * lines and keeps the ones that really have a ditch- or ridge-shaped cross section.
 * `sign` is -1 for ditches and 1 for ridges.
 */
function extractLinear(ctx, relief, threshold, sign, minLength) {
    const { grid, grad, t } = ctx;
    const { width: w, height: h, cell } = grid;
    const mask = new Uint8Array(w * h);
    for (let k = 0; k < mask.length; k++) {
        if (relief[k] >= threshold && !isNaN(grad.mag[k]))
            mask[k] = 1;
    }
    const { labels, count } = labelComponents(mask, w, h);
    if (count === 0)
        return [];
    const area = new Float64Array(count + 1);
    for (let k = 0; k < labels.length; k++)
        area[labels[k]]++;
    // blobs too small to hold a line of the minimum length are not worth thinning
    const minArea = minLength / cell;
    for (let k = 0; k < mask.length; k++) {
        if (mask[k] && area[labels[k]] < minArea)
            mask[k] = 0;
    }
    const skeleton = thin(mask, w, h);
    const paths = traceSkeleton(skeleton, w, h, Math.max(2, Math.round(4 / cell))).map((points) => ({
        points,
        label: labels[points[1] * w + points[0]],
        length: pathLength(points) * cell,
    }));
    const skeletonLength = new Float64Array(count + 1);
    for (const p of paths)
        skeletonLength[p.label] += p.length;
    const probe = Math.max(2, Math.round(4 / cell));
    const result = [];
    for (const p of paths) {
        if (p.length < minLength)
            continue;
        const width = (area[p.label] * cell * cell) / skeletonLength[p.label];
        if (width > t.linearMaxWidth ||
            skeletonLength[p.label] / width < t.linearMinElongation) {
            continue;
        }
        const n = p.points.length / 2;
        const amplitudes = [];
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
            if (len === 0)
                continue;
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
        if (profiles < 0.6 * n)
            continue;
        result.push({
            points: simplifyPath(smoothPath(p.points, 2), 0.35),
            length: p.length,
            amplitude: median(amplitudes),
        });
    }
    return result;
}
/** Erosion gullies (107, 108) and earth walls (105.1, 106). */
function detectLinear(ctx, out) {
    const { grid, t, o } = ctx;
    const { width: w, height: h, cell } = grid;
    const radius = Math.max(2, Math.round(t.linearScale / cell));
    const mean = boxMean(grid.data, w, h, radius);
    const relief = grid.data.map((v, k) => v - mean[k]);
    if (o.groups.has("gullies")) {
        const depth = relief.map((v) => -v);
        for (const c of extractLinear(ctx, depth, t.smallGullyMinDepth, -1, t.smallGullyMinLength)) {
            let kind;
            let isom;
            if (c.amplitude >= t.gullyMinDepth && c.length >= t.gullyMinLength) {
                kind = "erosion_gully";
                isom = 107;
            }
            else if (c.amplitude >= t.smallGullyMinDepth &&
                c.length >= t.smallGullyMinLength) {
                kind = "small_erosion_gully";
                isom = 108;
            }
            else {
                continue;
            }
            lineFeatures(ctx, toTileUnits(ctx, c.points), {
                kind,
                isom,
                depth: round1(c.amplitude),
                length: Math.round(c.length),
            }, out.lines);
        }
    }
    if (o.groups.has("walls")) {
        for (const c of extractLinear(ctx, relief, t.ruinedWallMinHeight, 1, Math.min(t.wallMinLength, t.ruinedWallMinLength))) {
            let kind;
            let isom;
            if (c.amplitude >= t.wallMinHeight && c.length >= t.wallMinLength) {
                kind = "earth_wall";
                isom = 105.1;
            }
            else if (c.amplitude >= t.ruinedWallMinHeight &&
                c.length >= t.ruinedWallMinLength) {
                kind = "ruined_earth_wall";
                isom = 106;
            }
            else {
                continue;
            }
            lineFeatures(ctx, toTileUnits(ctx, c.points), {
                kind,
                isom,
                height: round1(c.amplitude),
                length: Math.round(c.length),
            }, out.lines);
        }
    }
}
/** Broken ground (113) and very broken ground (114): areas where fine-scale relief is large. */
function detectBrokenGround(ctx, out) {
    const { grid, grad, t, s } = ctx;
    const { width: w, height: h, margin: m, cell } = grid;
    const steep = Math.tan(t.steepSlope * RAD);
    const fine = boxMean(grid.data, w, h, Math.max(1, Math.round(t.roughFineScale / cell)));
    const squared = new Float32Array(w * h);
    for (let k = 0; k < squared.length; k++) {
        const v = grid.data[k] - fine[k];
        // cliffs and banks are not broken ground
        squared[k] = grad.mag[k] >= steep ? 0 : v * v;
    }
    const meanSquare = boxMean(squared, w, h, Math.max(2, Math.round(t.roughScale / cell)));
    const roughness = meanSquare.map(Math.sqrt);
    const squareUnitsToMetres = (cell / s) ** 2;
    const levels = [
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
        const rings = (generateIsolines(1, tile, (grid.tileWidth - 1) * SUBPIXEL, m)[1] || []).filter((r) => r.length >= 8 && r[0] === r[r.length - 2] && r[1] === r[r.length - 1]);
        const outers = [];
        const holes = [];
        for (const raw of rings) {
            let ring = [];
            for (let k = 0; k < raw.length; k += 2) {
                ring.push(Math.round((raw[k] / SUBPIXEL + 0.5) * s), Math.round((raw[k + 1] / SUBPIXEL + 0.5) * s));
            }
            // marching squares keeps the rough ground on the left, so outlines of rough ground have a negative area
            const area = signedArea(ring);
            if (Math.abs(area) * squareUnitsToMetres < t.brokenMinArea)
                continue;
            // tile features want exterior rings clockwise and holes counterclockwise
            ring = reverseRing(ring);
            if (area < 0)
                outers.push({ ring, area: -area, holes: [] });
            else
                holes.push({ ring, area });
        }
        for (const hole of holes) {
            let owner;
            for (const outer of outers) {
                if (pointInRing(hole.ring[0], hole.ring[1], outer.ring) &&
                    (!owner || outer.area < owner.area)) {
                    owner = outer;
                }
            }
            owner === null || owner === void 0 ? void 0 : owner.holes.push(hole.ring);
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
            if (maxX < -b ||
                maxY < -b ||
                minX > ctx.extent + b ||
                minY > ctx.extent + b) {
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
function detectFormLines(ctx, corners, out) {
    const { grid, grad, t, o, s } = ctx;
    const { width: w, height: h, margin: m, cell } = grid;
    const interval = t.contourInterval;
    if (!(interval > 0))
        return;
    const maxMag = Math.tan(t.formLineMaxSlope * RAD);
    const lines = generateIsolines(interval / 2, corners, ctx.extent, o.buffer);
    for (const [eleString, list] of Object.entries(lines)) {
        const ele = Number(eleString);
        if (Math.abs(ele / interval - Math.round(ele / interval)) < 1e-6)
            continue;
        for (const line of list) {
            const n = line.length / 2;
            const flat = new Uint8Array(n);
            for (let k = 0; k < n; k++) {
                const mag = bilinear(grad.mag, w, h, line[2 * k] / s - 0.5 + m, line[2 * k + 1] / s - 0.5 + m);
                flat[k] = mag <= maxMag ? 1 : 0;
            }
            for (let start = 0; start < n; start++) {
                if (!flat[start])
                    continue;
                let end = start;
                while (end + 1 < n && flat[end + 1])
                    end++;
                const first = start;
                start = end;
                const piece = line.slice(2 * first, 2 * end + 2);
                if (piece.length < 6)
                    continue;
                if (pathLength(piece) * (cell / s) < t.formLineMinLength)
                    continue;
                lineFeatures(ctx, piece, { kind: "form_line", isom: 103, ele }, out.lines);
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
function detectLandforms(grid, options, corners) {
    const s = options.extent / grid.tileWidth;
    const ctx = {
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
    const out = { points: [], lines: [], ticks: [], areas: [] };
    const groups = options.groups;
    if (groups.has("knolls") ||
        groups.has("depressions") ||
        groups.has("boulders")) {
        detectBlobFeatures(ctx, out);
    }
    if (groups.has("banks"))
        detectBanks(ctx, out);
    if (groups.has("gullies") || groups.has("walls"))
        detectLinear(ctx, out);
    if (groups.has("brokenGround"))
        detectBrokenGround(ctx, out);
    if (groups.has("formLines") && corners)
        detectFormLines(ctx, corners, out);
    return out;
}
/** Side length of a web mercator tile on the ground in metres, at the tile's latitude. */
function groundTileSize(z, y) {
    const n = Math.PI - (2 * Math.PI * (y + 0.5)) / Math.pow(2, z);
    const latitude = Math.atan(Math.sinh(n));
    return (40075016.686 / Math.pow(2, z)) * Math.cos(latitude);
}
/** Pixels of surroundings the filters need, given the pixel size on the ground. */
function landformMargin(t, cell) {
    const reach = Math.max(t.linearScale, t.roughScale, t.cliffScanDistance, 12);
    return Math.ceil(reach / cell) + 2;
}
/**
 * Prepares a virtual tile (a tile plus its neighbors) for analysis: subsamples small tiles
 * and materializes `margin` pixels of surroundings at the final resolution.
 */
function prepareAnalysisTile(virtualTile, subsampleBelow, margin) {
    let factor = 1;
    while (virtualTile.width * factor < subsampleBelow)
        factor *= 2;
    const marginAt = (f) => Math.ceil((margin * f) / factor) + 3;
    if (factor === 1)
        return virtualTile.materialize(margin);
    let tile = virtualTile.materialize(marginAt(1));
    for (let f = 2; f <= factor; f *= 2) {
        tile = tile
            .subsamplePixelCenters(2)
            .materialize(f === factor ? margin : marginAt(f));
    }
    return tile;
}

const perf = typeof performance !== "undefined" ? performance : undefined;
const timeOrigin = perf
    ? perf.timeOrigin || new Date().getTime() - perf.now()
    : new Date().getTime();
function getResourceTiming(url) {
    var _a;
    return JSON.parse(JSON.stringify(((_a = perf === null || perf === void 0 ? void 0 : perf.getEntriesByName) === null || _a === void 0 ? void 0 : _a.call(perf, url)) || []));
}
function now() {
    return perf ? perf.now() : new Date().getTime();
}
function flatten(input) {
    const result = [];
    for (const list of input) {
        result.push(...list);
    }
    return result;
}
/** Utility for tracking how long tiles take to generate, and where the time is going. */
class Timer {
    constructor(name) {
        this.marks = {};
        this.urls = [];
        this.fetched = [];
        this.resources = [];
        this.tilesFetched = 0;
        this.timeOrigin = timeOrigin;
        this.finish = (url) => {
            this.markFinish();
            const get = (type) => {
                const all = this.marks[type] || [];
                const max = Math.max(...all.map((ns) => Math.max(...ns)));
                const min = Math.min(...all.map((ns) => Math.min(...ns)));
                return Number.isFinite(max) ? max - min : undefined;
            };
            const duration = get("main") || 0;
            const fetch = get("fetch");
            const decode = get("decode");
            const process = get("isoline");
            return {
                url,
                tilesUsed: this.tilesFetched,
                origin: this.timeOrigin,
                marks: this.marks,
                resources: [
                    ...this.resources,
                    ...flatten(this.fetched.map(getResourceTiming)),
                ],
                duration,
                fetch,
                decode,
                process,
                wait: duration - (fetch || 0) - (decode || 0) - (process || 0),
            };
        };
        this.error = (url) => (Object.assign(Object.assign({}, this.finish(url)), { error: true }));
        this.marker = (category) => {
            var _a;
            if (!this.marks[category]) {
                this.marks[category] = [];
            }
            const marks = [now()];
            (_a = this.marks[category]) === null || _a === void 0 ? void 0 : _a.push(marks);
            return () => marks.push(now());
        };
        this.useTile = (url) => {
            if (this.urls.indexOf(url) < 0) {
                this.urls.push(url);
                this.tilesFetched++;
            }
        };
        this.fetchTile = (url) => {
            if (this.fetched.indexOf(url) < 0) {
                this.fetched.push(url);
            }
        };
        this.addAll = (timings) => {
            var _a;
            this.tilesFetched += timings.tilesUsed;
            const offset = timings.origin - this.timeOrigin;
            for (const category in timings.marks) {
                const key = category;
                const ourList = this.marks[key] || (this.marks[key] = []);
                ourList.push(...(((_a = timings.marks[key]) === null || _a === void 0 ? void 0 : _a.map((ns) => ns.map((n) => n + offset))) || []));
            }
            this.resources.push(...timings.resources.map((rt) => applyOffset(rt, offset)));
        };
        this.markFinish = this.marker(name);
    }
}
const startOrEnd = /(Start$|End$|^start|^end)/;
function applyOffset(obj, offset) {
    const result = {};
    for (const key in obj) {
        if (obj[key] !== 0 && startOrEnd.test(key)) {
            result[key] = Number(obj[key]) + offset;
        }
        else {
            result[key] = obj[key];
        }
    }
    return result;
}

const defaultGetTile = (url, abortController) => __awaiter(void 0, void 0, void 0, function* () {
    const options = {
        signal: abortController.signal,
    };
    const response = yield fetch(url, options);
    if (!response.ok) {
        throw new Error(`Bad response: ${response.status} for ${url}`);
    }
    return {
        data: yield response.blob(),
        expires: response.headers.get("expires") || undefined,
        cacheControl: response.headers.get("cache-control") || undefined,
    };
});
/**
 * Caches, decodes, and processes raster tiles in the current thread.
 */
class LocalDemManager {
    constructor(options) {
        this.loaded = Promise.resolve();
        this.fetchAndParseTile = (z, x, y, abortController, timer) => {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this;
            const url = this.demUrlPattern
                .replace("{z}", z.toString())
                .replace("{x}", x.toString())
                .replace("{y}", y.toString());
            timer === null || timer === void 0 ? void 0 : timer.useTile(url);
            return this.parsedCache.get(url, (_, childAbortController) => __awaiter(this, void 0, void 0, function* () {
                const response = yield self.fetchTile(z, x, y, childAbortController, timer);
                if (isAborted(childAbortController))
                    throw new Error("canceled");
                const promise = self.decodeImage(response.data, self.encoding, childAbortController);
                const mark = timer === null || timer === void 0 ? void 0 : timer.marker("decode");
                const result = yield promise;
                mark === null || mark === void 0 ? void 0 : mark();
                return result;
            }), abortController);
        };
        this.tileCache = new AsyncCache(options.cacheSize);
        this.parsedCache = new AsyncCache(options.cacheSize);
        this.contourCache = new AsyncCache(options.cacheSize);
        this.landformCache = new AsyncCache(options.cacheSize);
        this.timeoutMs = options.timeoutMs;
        this.demUrlPattern = options.demUrlPattern;
        this.encoding = options.encoding;
        this.maxzoom = options.maxzoom;
        this.decodeImage = options.decodeImage || defaultDecoder;
        this.getTile = options.getTile || defaultGetTile;
    }
    fetchTile(z, x, y, parentAbortController, timer) {
        const url = this.demUrlPattern
            .replace("{z}", z.toString())
            .replace("{x}", x.toString())
            .replace("{y}", y.toString());
        timer === null || timer === void 0 ? void 0 : timer.useTile(url);
        return this.tileCache.get(url, (_, childAbortController) => {
            timer === null || timer === void 0 ? void 0 : timer.fetchTile(url);
            const mark = timer === null || timer === void 0 ? void 0 : timer.marker("fetch");
            return withTimeout(this.timeoutMs, this.getTile(url, childAbortController).finally(() => mark === null || mark === void 0 ? void 0 : mark()), childAbortController, `Fetching DEM tile ${url}`);
        }, parentAbortController);
    }
    fetchDem(z, x, y, options, abortController, timer) {
        return __awaiter(this, void 0, void 0, function* () {
            const zoom = Math.max(0, Math.min(z - (options.overzoom || 0), this.maxzoom));
            const subZ = z - zoom;
            const div = 1 << subZ;
            const newX = Math.floor(x / div);
            const newY = Math.floor(y / div);
            const tile = yield this.fetchAndParseTile(zoom, newX, newY, abortController, timer);
            return HeightTile.fromRawDem(tile).split(subZ, x % div, y % div);
        });
    }
    fetchContourTile(z, x, y, options, parentAbortController, timer) {
        const { levels, multiplier = 1, buffer = 1, extent = 4096, contourLayer = "contours", elevationKey = "ele", levelKey = "level", subsampleBelow = 100, } = options;
        // no levels means less than min zoom with levels specified
        if (!levels || levels.length === 0) {
            return Promise.resolve({ arrayBuffer: new ArrayBuffer(0) });
        }
        const key = [z, x, y, encodeIndividualOptions(options)].join("/");
        const cached = this.contourCache.get(key, (_, childAbortController) => __awaiter(this, void 0, void 0, function* () {
            const max = 1 << z;
            const neighborPromises = [];
            for (let iy = y - 1; iy <= y + 1; iy++) {
                for (let ix = x - 1; ix <= x + 1; ix++) {
                    neighborPromises.push(iy < 0 || iy >= max
                        ? undefined
                        : this.fetchDem(z, (ix + max) % max, iy, options, childAbortController, timer));
                }
            }
            const neighbors = yield Promise.all(neighborPromises);
            let virtualTile = HeightTile.combineNeighbors(neighbors);
            if (!virtualTile || isAborted(childAbortController)) {
                return { arrayBuffer: new Uint8Array().buffer };
            }
            const mark = timer === null || timer === void 0 ? void 0 : timer.marker("isoline");
            if (virtualTile.width >= subsampleBelow) {
                virtualTile = virtualTile.materialize(2);
            }
            else {
                while (virtualTile.width < subsampleBelow) {
                    virtualTile = virtualTile.subsamplePixelCenters(2).materialize(2);
                }
            }
            virtualTile = virtualTile
                .averagePixelCentersToGrid()
                .scaleElevation(multiplier)
                .materialize(1);
            const isolines = generateIsolines(levels[0], virtualTile, extent, buffer);
            mark === null || mark === void 0 ? void 0 : mark();
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
                                    [levelKey]: Math.max(...levels.map((l, i) => (ele % l === 0 ? i : 0))),
                                },
                            };
                        }),
                    },
                },
            });
            mark === null || mark === void 0 ? void 0 : mark();
            return { arrayBuffer: result.slice().buffer };
        }), parentAbortController);
        // maplibre transfers the buffer to its own worker, which would detach the
        // copy held in the cache, so give each caller its own
        return cached.then(({ arrayBuffer }) => ({
            arrayBuffer: copy(arrayBuffer),
        }));
    }
    /**
     * Detects orienteering landforms around a tile: small knolls, pits, depressions, earth banks and
     * cliffs (with tags), gullies, earth walls, form lines and broken ground. Needs a high resolution DEM.
     */
    fetchLandformTile(z, x, y, options, parentAbortController, timer) {
        const resolved = resolveLandformOptions(options);
        const key = [z, x, y, "landforms", resolved.key].join("/");
        const cached = this.landformCache.get(key, (_, childAbortController) => __awaiter(this, void 0, void 0, function* () {
            const max = 1 << z;
            const neighborPromises = [];
            for (let iy = y - 1; iy <= y + 1; iy++) {
                for (let ix = x - 1; ix <= x + 1; ix++) {
                    neighborPromises.push(iy < 0 || iy >= max
                        ? undefined
                        : this.fetchDem(z, (ix + max) % max, iy, resolved, childAbortController, timer));
                }
            }
            const neighbors = yield Promise.all(neighborPromises);
            const virtualTile = HeightTile.combineNeighbors(neighbors);
            if (!virtualTile || isAborted(childAbortController)) {
                return { arrayBuffer: new Uint8Array().buffer };
            }
            const { thresholds } = resolved;
            const ground = groundTileSize(z, y);
            // too coarse to see anything the size of an orienteering feature
            const sourceWidth = neighbors[4].width;
            if (ground / sourceWidth > thresholds.maxCellSize) {
                return { arrayBuffer: new Uint8Array().buffer };
            }
            const mark = timer === null || timer === void 0 ? void 0 : timer.marker("isoline");
            let factor = 1;
            while (virtualTile.width * factor < resolved.subsampleBelow) {
                factor *= 2;
            }
            const width = virtualTile.width * factor;
            const cell = ground / width;
            const margin = Math.min(landformMargin(thresholds, cell), width);
            const analysisTile = prepareAnalysisTile(virtualTile, resolved.subsampleBelow, margin);
            const grid = Grid.fromHeightTile(analysisTile, margin, cell);
            const corners = resolved.groups.has("formLines")
                ? analysisTile.averagePixelCentersToGrid().materialize(1)
                : undefined;
            const found = detectLandforms(grid, resolved, corners);
            mark === null || mark === void 0 ? void 0 : mark();
            const result = encodeVectorTile({
                extent: resolved.extent,
                layers: {
                    landform_points: { features: found.points },
                    landform_lines: { features: found.lines },
                    landform_ticks: { features: found.ticks },
                    landform_areas: { features: found.areas },
                },
            });
            mark === null || mark === void 0 ? void 0 : mark();
            return { arrayBuffer: result.slice().buffer };
        }), parentAbortController);
        return cached.then(({ arrayBuffer }) => ({
            arrayBuffer: copy(arrayBuffer),
        }));
    }
}

let id = 0;
/**
 * Utility for sending messages to a remote instance of `<T>` running in a web worker
 * from the main thread, or in the main thread running from a web worker.
 */
class Actor {
    constructor(dest, dispatcher, timeoutMs = 20000) {
        this.callbacks = {};
        this.cancels = {};
        this.dest = dest;
        this.timeoutMs = timeoutMs;
        this.dest.onmessage = (_a) => __awaiter(this, [_a], void 0, function* ({ data }) {
            const message = data;
            if (message.type === "cancel") {
                const cancel = this.cancels[message.id];
                delete this.cancels[message.id];
                cancel === null || cancel === void 0 ? void 0 : cancel.abort();
            }
            else if (message.type === "response") {
                const callback = this.callbacks[message.id];
                delete this.callbacks[message.id];
                if (callback) {
                    callback(message.error ? new Error(message.error) : undefined, message.response, message.timings);
                }
            }
            else if (message.type === "request") {
                const timer = new Timer("worker");
                // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
                const handler = dispatcher[message.name];
                const abortController = new AbortController();
                const request = handler.apply(handler, [
                    ...message.args,
                    abortController,
                    timer,
                ]);
                const url = `${message.name}_${message.id}`;
                if (message.id && request) {
                    this.cancels[message.id] = abortController;
                    try {
                        const response = yield request;
                        const transferrables = response === null || response === void 0 ? void 0 : response.transferrables;
                        this.postMessage({
                            id: message.id,
                            type: "response",
                            response,
                            timings: timer.finish(url),
                        }, transferrables);
                    }
                    catch (e) {
                        this.postMessage({
                            id: message.id,
                            type: "response",
                            error: (e === null || e === void 0 ? void 0 : e.toString()) || "error",
                            timings: timer.finish(url),
                        });
                    }
                    delete this.cancels[message.id];
                }
            }
        });
    }
    postMessage(message, transferrables) {
        this.dest.postMessage(message, transferrables || []);
    }
    /** Invokes a method by name with a set of arguments in the remote context. */
    send(name, transferrables, abortController, timer, ...args) {
        const thisId = ++id;
        const value = new Promise((resolve, reject) => {
            this.postMessage({ id: thisId, type: "request", name, args }, transferrables);
            this.callbacks[thisId] = (error, result, timings) => {
                timer === null || timer === void 0 ? void 0 : timer.addAll(timings);
                if (error)
                    reject(error);
                else
                    resolve(result);
            };
        });
        onAbort(abortController, () => {
            delete this.callbacks[thisId];
            this.postMessage({ id: thisId, type: "cancel" });
        });
        return withTimeout(this.timeoutMs, value, abortController, `Worker request "${name}"`);
    }
}

exports.A = Actor;
exports.D = DEFAULT_LANDFORM_THRESHOLDS;
exports.G = Grid;
exports.H = HeightTile;
exports.L = LocalDemManager;
exports.T = Timer;
exports._ = __awaiter;
exports.a = parseUrl;
exports.b = decodeOptions;
exports.c = decodeLandformOptions;
exports.d = defaultDecoder;
exports.e = encodeOptions;
exports.f = encodeLandformOptions;
exports.g = getOptionsForZoom;
exports.h = decodeParsedImage;
exports.i = DEFAULT_LANDFORM_GROUPS;
exports.j = ALL_LANDFORM_GROUPS;
exports.k = detectLandforms;
exports.l = generateIsolines;
exports.m = prepareContourTile;
exports.p = prepareDemTile;
exports.r = resolveLandformOptions;

}));

define(['./shared'], (function (actor) { 'use strict';

const noManager = (managerId) => Promise.reject(new Error(`No manager registered for ${managerId}`));
/**
 * Receives messages from an actor in the web worker.
 */
class WorkerDispatch {
    constructor() {
        /** There is one worker shared between all managers in the main thread using the plugin, so need to store each of their configurations. */
        this.managers = {};
        this.init = (message, _) => {
            this.managers[message.managerId] = new actor.L(message);
            return Promise.resolve();
        };
        this.fetchTile = (managerId, z, x, y, abortController, timer) => {
            var _a;
            return ((_a = this.managers[managerId]) === null || _a === void 0 ? void 0 : _a.fetchTile(z, x, y, abortController, timer)) ||
                noManager(managerId);
        };
        this.fetchAndParseTile = (managerId, z, x, y, abortController, timer) => {
            var _a;
            return actor.p(((_a = this.managers[managerId]) === null || _a === void 0 ? void 0 : _a.fetchAndParseTile(z, x, y, abortController, timer)) || noManager(managerId), true);
        };
        this.fetchContourTile = (managerId, z, x, y, options, abortController, timer) => {
            var _a;
            return actor.m(((_a = this.managers[managerId]) === null || _a === void 0 ? void 0 : _a.fetchContourTile(z, x, y, options, abortController, timer)) || noManager(managerId));
        };
        this.fetchLandformTile = (managerId, z, x, y, options, abortController, timer) => {
            var _a;
            return actor.m(((_a = this.managers[managerId]) === null || _a === void 0 ? void 0 : _a.fetchLandformTile(z, x, y, options, abortController, timer)) || noManager(managerId));
        };
    }
}

const g = typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
        ? window
        : global;
g.actor = new actor.A(g, new WorkerDispatch());

}));

define(['./shared'], (function (actor) { 'use strict';

const CONFIG = { workerUrl: "" };

let _actor;
let id = 0;
class MainThreadDispatch {
    constructor() {
        this.decodeImage = (blob, encoding, abortController) => actor.p(actor.d(blob, encoding, abortController), false);
    }
}
function defaultActor() {
    if (!_actor) {
        const worker = new Worker(CONFIG.workerUrl);
        const dispatch = new MainThreadDispatch();
        _actor = new actor.A(worker, dispatch);
    }
    return _actor;
}
/**
 * Caches, decodes, and processes raster tiles in a shared web worker.
 */
class RemoteDemManager {
    constructor(options) {
        this.fetchTile = (z, x, y, abortController, timer) => this.actor.send("fetchTile", [], abortController, timer, this.managerId, z, x, y);
        this.fetchAndParseTile = (z, x, y, abortController, timer) => this.actor.send("fetchAndParseTile", [], abortController, timer, this.managerId, z, x, y);
        this.fetchContourTile = (z, x, y, options, abortController, timer) => this.actor.send("fetchContourTile", [], abortController, timer, this.managerId, z, x, y, options);
        this.fetchLandformTile = (z, x, y, options, abortController, timer) => this.actor.send("fetchLandformTile", [], abortController, timer, this.managerId, z, x, y, options);
        const managerId = (this.managerId = ++id);
        this.actor = options.actor || defaultActor();
        this.loaded = this.actor.send("init", [], new AbortController(), undefined, Object.assign(Object.assign({}, options), { managerId }));
    }
}

if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function arrayBuffer() {
        return new Promise((resolve, reject) => {
            const fileReader = new FileReader();
            fileReader.onload = (event) => { var _a; return resolve((_a = event.target) === null || _a === void 0 ? void 0 : _a.result); };
            fileReader.onerror = reject;
            fileReader.readAsArrayBuffer(this);
        });
    };
}
const v3compat = (v4) => (requestParameters, arg2) => {
    if (arg2 instanceof AbortController) {
        return v4(requestParameters, arg2);
    }
    else {
        const abortController = new AbortController();
        v4(requestParameters, abortController)
            .then((result) => arg2(undefined, result.data, result.cacheControl, result.expires), (err) => arg2(err))
            .catch((err) => arg2(err));
        return { cancel: () => abortController.abort() };
    }
};
const used = new Set();
/**
 * A remote source of DEM tiles that can be connected to maplibre.
 */
class DemSource {
    constructor({ url, cacheSize = 100, id = "dem", encoding = "terrarium", maxzoom = 12, worker = true, timeoutMs = 10000, actor: actor$1, }) {
        this.timingCallbacks = [];
        /** Registers a callback to be invoked with a performance report after each tile is requested. */
        this.onTiming = (callback) => {
            this.timingCallbacks.push(callback);
        };
        /**
         * Adds contour and shared DEM protocol handlers to maplibre.
         *
         * @param maplibre maplibre global object
         */
        this.setupMaplibre = (maplibre) => {
            maplibre.addProtocol(this.sharedDemProtocolId, this.sharedDemProtocol);
            maplibre.addProtocol(this.contourProtocolId, this.contourProtocol);
            maplibre.addProtocol(this.landformProtocolId, this.landformProtocol);
        };
        /**
         * Callback to be used with maplibre addProtocol to re-use cached DEM tiles across sources.
         */
        this.sharedDemProtocolV4 = (request, abortController) => actor._(this, void 0, void 0, function* () {
            const [z, x, y] = actor.a(request.url);
            const timer = new actor.T("main");
            let timing;
            try {
                const data = yield this.manager.fetchTile(z, x, y, abortController, timer);
                timing = timer.finish(request.url);
                const arrayBuffer = yield data.data.arrayBuffer();
                return {
                    data: arrayBuffer,
                    cacheControl: data.cacheControl,
                    expires: data.expires,
                };
            }
            catch (error) {
                timing = timer.error(request.url);
                throw error;
            }
            finally {
                this.timingCallbacks.forEach((cb) => cb(timing));
            }
        });
        /**
         * Callback to be used with maplibre addProtocol to generate contour vector tiles according
         * to options encoded in the tile URL pattern generated by `contourProtocolUrl`.
         */
        this.contourProtocolV4 = (request, abortController) => actor._(this, void 0, void 0, function* () {
            const timer = new actor.T("main");
            let timing;
            try {
                const [z, x, y] = actor.a(request.url);
                const options = actor.b(request.url);
                const data = yield this.manager.fetchContourTile(z, x, y, actor.g(options, z), abortController, timer);
                timing = timer.finish(request.url);
                return { data: data.arrayBuffer };
            }
            catch (error) {
                timing = timer.error(request.url);
                throw error;
            }
            finally {
                this.timingCallbacks.forEach((cb) => cb(timing));
            }
        });
        /**
         * Callback to be used with maplibre addProtocol to detect orienteering landforms according
         * to options encoded in the tile URL pattern generated by `landformProtocolUrl`.
         */
        this.landformProtocolV4 = (request, abortController) => actor._(this, void 0, void 0, function* () {
            const timer = new actor.T("main");
            let timing;
            try {
                const [z, x, y] = actor.a(request.url);
                const options = actor.c(request.url);
                const data = yield this.manager.fetchLandformTile(z, x, y, options, abortController, timer);
                timing = timer.finish(request.url);
                return { data: data.arrayBuffer };
            }
            catch (error) {
                timing = timer.error(request.url);
                throw error;
            }
            finally {
                this.timingCallbacks.forEach((cb) => cb(timing));
            }
        });
        this.contourProtocol = v3compat(this.contourProtocolV4);
        this.landformProtocol = v3compat(this.landformProtocolV4);
        this.sharedDemProtocol = v3compat(this.sharedDemProtocolV4);
        /**
         * Returns a URL with the correct maplibre protocol prefix and all `option` encoded in request parameters.
         */
        this.contourProtocolUrl = (options) => `${this.contourProtocolUrlBase}?${actor.e(options)}`;
        /**
         * Returns a URL with the landform protocol prefix and all `options` encoded in request parameters.
         * The vector tiles have layers `landform_points`, `landform_lines`, `landform_ticks` and `landform_areas`.
         */
        this.landformProtocolUrl = (options = {}) => `${this.landformProtocolUrlBase}?${actor.f(options)}`;
        let protocolPrefix = id;
        let i = 1;
        while (used.has(protocolPrefix)) {
            protocolPrefix = id + i++;
        }
        used.add(protocolPrefix);
        this.sharedDemProtocolId = `${protocolPrefix}-shared`;
        this.contourProtocolId = `${protocolPrefix}-contour`;
        this.landformProtocolId = `${protocolPrefix}-landform`;
        this.landformProtocolUrlBase = `${this.landformProtocolId}://{z}/{x}/{y}`;
        this.sharedDemProtocolUrl = `${this.sharedDemProtocolId}://{z}/{x}/{y}`;
        this.contourProtocolUrlBase = `${this.contourProtocolId}://{z}/{x}/{y}`;
        const ManagerClass = worker ? RemoteDemManager : actor.L;
        this.manager = new ManagerClass({
            demUrlPattern: url,
            cacheSize,
            encoding,
            maxzoom,
            timeoutMs,
            actor: actor$1,
        });
    }
    getDemTile(z, x, y, abortController) {
        return this.manager.fetchAndParseTile(z, x, y, abortController || new AbortController());
    }
}

const exported = {
    generateIsolines: actor.l,
    detectLandforms: actor.k,
    resolveLandformOptions: actor.r,
    ALL_LANDFORM_GROUPS: actor.j,
    DEFAULT_LANDFORM_GROUPS: actor.i,
    DEFAULT_LANDFORM_THRESHOLDS: actor.D,
    Grid: actor.G,
    DemSource,
    HeightTile: actor.H,
    LocalDemManager: actor.L,
    decodeParsedImage: actor.h,
    set workerUrl(url) {
        CONFIG.workerUrl = url;
    },
    get workerUrl() {
        return CONFIG.workerUrl;
    },
};

return exported;

}));

/* eslint-disable no-undef */

var mlcontour$1 = mlcontour;

export { mlcontour$1 as default };
