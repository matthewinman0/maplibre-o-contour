# maplibre-contour

maplibre-contour is a plugin to render contour lines in [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) from `raster-dem` sources that powers the terrain mode for [onthegomap.com](https://onthegomap.com).

![Topographic map of Mount Washington](demo.png)

[Live example](https://onthegomap.github.io/maplibre-contour) | [Code](./index.html)

To use it, import the [maplibre-contour](https://www.npmjs.com/package/maplibre-contour) package with a script tag:

```html
<script src="https://unpkg.com/maplibre-contour@0.1.0/dist/index.min.js"></script>
```

Or as an ES6 module: `npm add maplibre-contour`

```js
import mlcontour from "maplibre-contour";
```

Then to use, first create a `DemSource` and register it with maplibre:

```js
var demSource = new mlcontour.DemSource({
  url: "https://url/of/dem/source/{z}/{x}/{y}.png",
  encoding: "terrarium", // "mapbox" or "terrarium" default="terrarium"
  maxzoom: 13,
  worker: true, // offload isoline computation to a web worker to reduce jank
  cacheSize: 100, // number of most-recent tiles to cache
  timeoutMs: 10_000, // timeout on fetch requests
});
demSource.setupMaplibre(maplibregl);
```

Then configure a new contour source and add it to your map:

```js
map.addSource("contour-source", {
  type: "vector",
  tiles: [
    demSource.contourProtocolUrl({
      // convert meters to feet, default=1 for meters
      multiplier: 3.28084,
      thresholds: {
        // zoom: [minor, major]
        11: [200, 1000],
        12: [100, 500],
        14: [50, 200],
        15: [20, 100],
      },
      // optional, override vector tile parameters:
      contourLayer: "contours",
      elevationKey: "ele",
      levelKey: "level",
      extent: 4096,
      buffer: 1,
    }),
  ],
  maxzoom: 15,
});
```

Then add contour line and label layers:

```js
map.addLayer({
  id: "contour-lines",
  type: "line",
  source: "contour-source",
  "source-layer": "contours",
  paint: {
    "line-color": "rgba(0,0,0, 50%)",
    // level = highest index in thresholds array the elevation is a multiple of
    "line-width": ["match", ["get", "level"], 1, 1, 0.5],
  },
});
map.addLayer({
  id: "contour-labels",
  type: "symbol",
  source: "contour-source",
  "source-layer": "contours",
  filter: [">", ["get", "level"], 0],
  layout: {
    "symbol-placement": "line",
    "text-size": 10,
    "text-field": ["concat", ["number-format", ["get", "ele"], {}], "'"],
    "text-font": ["Noto Sans Bold"],
  },
  paint: {
    "text-halo-color": "white",
    "text-halo-width": 1,
  },
});
```

You can also share the cached tiles with other maplibre sources that need elevation data:

```js
map.addSource("dem", {
  type: "raster-dem",
  encoding: "terrarium",
  tiles: [demSource.sharedDemProtocolUrl],
  maxzoom: 13,
  tileSize: 256,
});
```

### Import it to a maplibre worker

This is an alternative method, which reduces bundle size and also supports other protocols, but it's a bit more complicated to setup.
It's similar to how the RTL plugin works.

Import the script from a CDN:

```ts
maplibregl.importScriptInWorkers("https://unpkg.com/maplibre-contour@0.1.0/dist/add-protocol-worker.js");

const dispatcher = maplibregl.getGlobalDispatcher();
dispatcher.registerMessageHandler("contour-worker" as any, async () => { // when the script finishes loading in the workers it will send out this message.

  await dispatcher.broadcast("contour-worker" as any, { // this is to configure the worker with the relevant parameters
      demUrlPattern: "https://url/of/dem/source/{z}/{x}/{y}.png", // this can also support other protocols such as pmtiles://
      encoding: "terrarium",
      maxzoom: 13
  });

  // once this is configured, you can add a source with the following address for example, and layers as described above.
  map.addSource("contour-source", {
    type: "vector",
    tiles: ["dem-contour://{z}/{x}/{y}?contourLayer=contours&elevationKey=ele&levelKey=level&multiplier=3.28084&overzoom=1&thresholds=11*200*1000~12*10*100~13*10*100~14*10*100~15*10*100"],
  });
});
```

# Orienteering landforms (ISOM)

Besides contours, the same DEM tiles can be searched for the landforms that an orienteering map ([ISOM 2017-2](https://omapwiki.orienteering.sport/specifications/isom/)) draws as symbols. Detection runs in the browser (in the web worker when `worker: true`) with the same caching as contours. See [landforms.html](./landforms.html) for a styled example.

**This needs a DEM of roughly 1 m resolution** (LiDAR derived). A knoll or pit is a metre or two across, so on a 30 m global DEM there is nothing to find: tiles whose source pixels are larger than `maxCellSize` (4 m by default) come back empty.

```js
map.addSource("landforms", {
  type: "vector",
  tiles: [
    demSource.landformProtocolUrl({
      // default: everything except boulders
      features: ["knolls", "depressions", "banks", "gullies", "walls", "formLines", "brokenGround"],
      // optional, override any threshold (metres, degrees), see DEFAULT_LANDFORM_THRESHOLDS
      thresholds: { knollMinHeight: 0.5, steepSlope: 45 },
    }),
  ],
  minzoom: 14,
  maxzoom: 17, // the highest zoom your DEM has
});
```

`demSource.setupMaplibre` registers the landform protocol next to the contour one. In the worker-import setup the protocol is `dem-landform://{z}/{x}/{y}?o=<url-encoded JSON of the options>`.

## What is detected

| ISOM | Feature | `kind` | Layer | How |
| --- | --- | --- | --- | --- |
| 103 | Form line | `form_line` | `landform_lines` | half-interval contours, kept only where the ground is flatter than `formLineMaxSlope` |
| 104 | Earth bank | `bank` | `landform_lines`, tags in `landform_ticks` | top edge of ground steeper than `steepSlope` that drops at least 1 m |
| 202 | Cliff | `cliff` | same | as above, median slope of at least `cliffSlope` |
| 201 | Impassable cliff | `impassable_cliff` | same | as above, at least `impassableMinHeight` high and `impassableSlope` steep |
| 105.1 / 106 | Earth wall / ruined earth wall | `earth_wall`, `ruined_earth_wall` | `landform_lines` | narrow, elongated ridges at least 1 m / 0.5 m high and 21 m / 55 m long |
| 107 / 108 | Erosion gully / small erosion gully | `erosion_gully`, `small_erosion_gully` | `landform_lines` | narrow, elongated ditches at least 1 m / 0.5 m deep, reduced to a centre line |
| 109 | Small knoll | `knoll` | `landform_points` | mound at least 1 m high, found by flooding the inverted terrain |
| 110 | Small elongated knoll | `elongated_knoll` | `landform_points` | as above with a length/width ratio of 1.7 or more, `orient` is the bearing of the long axis |
| 111 | Small depression | `depression` | `landform_points` | closed depression at least 1 m deep and 2 m wide with gentle sides |
| 112 | Pit | `pit` | `landform_points` | closed depression at least 1 m deep with steep sides (35° or more) |
| 113 / 114 | Broken / very broken ground | `broken_ground`, `very_broken_ground` | `landform_areas` | outlines of ground where small-scale relief is rough |
| 204 / 205 | Boulder / large boulder | `boulder`, `large_boulder` | `landform_points` | off by default: small, steep mounds at least 1 m / 2 m high |

Every feature has `kind` and `isom` (the symbol number). Points also carry `ele` (metres), `height` or `depth`, `length` and `width` (metres), and two flags that help you decide what to draw: `small` is true when the feature is too small to be drawn with contours (see ISOM 101), and `contoured` is true when a contour at your `contourInterval` (5 m by default) already passes through it. Lines carry `height`/`depth`, `slope` or `length` where that makes sense, and form lines carry `ele`.

Cliff and bank tags are separate features in `landform_ticks`, pointing downhill from the top edge, spaced by `tickSpacing` tile units (default 80, about 10 px on a 512 px tile). Draw them with a `line` layer.

## Not in the DEM

Most of ISOM is not visible in an elevation model: water and marshes, vegetation, paths, roads, buildings, fences, walls, stony ground, sand, trenches that are man-made, prominent features, and the exact location of boulders under trees. Those need other sources (for example OpenStreetMap) or a visit in the field.

## Read this before trusting the output

- These are heuristics. They are tested on synthetic terrain, not tuned against real LiDAR, so expect to adjust the thresholds for your DEM and terrain.
- A DEM cannot tell an earth bank from a rock face. Banks and cliffs are separated by height and steepness only.
- Gully and wall detection compares the ground with its surroundings within `linearScale` (10 m), so wide valleys and broad ridges are ignored on purpose.
- Boulders are a guess: a boulder on a bare-earth DEM is usually filtered out, and a small steep knoll looks the same.
- Features are measured in a window around the tile, so they continue across tile edges. Points are emitted by the tile that contains their centre, lines are clipped at the tile edge.

# How it works

<img src="architecture.png" width="500">

[`DemSource.setupMaplibre`](./src/dem-source.ts) uses MapLibre's [`addProtocol`](https://maplibre.org/maplibre-gl-js-docs/api/properties/#addprotocol) utility to register a callback to provide vector tile for the contours source. Each time maplibre requests a vector tile:

- [`DemManager`](./src/dem-manager.ts) fetches (and caches) the raster-dem image tile and its neighbors so that contours are continuous across tile boundaries.
  - When `DemSource` is configured with `worker: true`, it uses [`RemoteDemManager`](./src/remote-dem-manager.ts) to spawn [`worker.ts`](./src/worker.ts) in a web worker. The web worker runs [`LocalDemManager`](./src/dem-manager.ts) locally and uses the [`Actor`](./src/actor.ts) utility to send cancelable requests and responses between the main and worker thread.
- [`decode-image.ts`](./src/decode-image.ts) decodes the raster-dem image RGB values to meters above sea level for each pixel in the tile.
- [`HeightTile`](./src/height-tile.ts) stitches those raw DEM tiles into a "virtual tile" that contains the border of neighboring tiles, aligns elevation measurements to the tile grid, and smooths the elevation measurements.
- [`isoline.ts`](./src/isolines.ts) generates contour isolines from a `HeightTile` using a marching-squares implementation derived from [d3-contour](https://github.com/d3/d3-contour).
- [`landforms.ts`](./src/landforms.ts) finds the ISOM landforms above in a window of elevations around the tile, using [`landform-grid.ts`](./src/landform-grid.ts) and [`landform-ops.ts`](./src/landform-ops.ts) for gradients, priority-flood depression filling, skeletons and polygon helpers. Thresholds live in [`landform-options.ts`](./src/landform-options.ts).
- [`vtpbf.ts`](./src/vtpbf.ts) encodes the contour isolines as mapbox vector tile bytes.

MapLibre sends that vector tile to its own worker, decodes it, and renders as if it had been generated by a server.

# Why?

There are a lot of parameters you can tweak when generating contour lines from elevation data like units, thresholds, and smoothing parameters. Pre-generated contour vector tiles require 100+gb of storage for each variation you want to generate and host. Generating them on-the-fly in the browser gives infinite control over the variations you can use on a map from the same source of raw elevation data that maplibre uses to render hillshade.

# License

maplibre-contour is licensed under the [BSD 3-Clause License](LICENSE). It includes code adapted from:

- [d3-contour](https://github.com/d3/d3-contour) (ISC license)
- [vt-pbf](https://github.com/mapbox/vt-pbf) (MIT license)
