import generateIsolines from "./isolines";
import { DemSource } from "./dem-source";
import { decodeParsedImage } from "./decode-image";
import { LocalDemManager } from "./local-dem-manager";
import CONFIG from "./config";
import { HeightTile } from "./height-tile";
import { detectLandforms } from "./landforms";
import { Grid } from "./landform-grid";
import {
  ALL_LANDFORM_GROUPS,
  DEFAULT_LANDFORM_GROUPS,
  DEFAULT_LANDFORM_THRESHOLDS,
  resolveLandformOptions,
} from "./landform-options";

const exported = {
  generateIsolines,
  detectLandforms,
  resolveLandformOptions,
  ALL_LANDFORM_GROUPS,
  DEFAULT_LANDFORM_GROUPS,
  DEFAULT_LANDFORM_THRESHOLDS,
  Grid,
  DemSource,
  HeightTile,
  LocalDemManager,
  decodeParsedImage,
  set workerUrl(url: string) {
    CONFIG.workerUrl = url;
  },
  get workerUrl() {
    return CONFIG.workerUrl;
  },
};
export default exported;
