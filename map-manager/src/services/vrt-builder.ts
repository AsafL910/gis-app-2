import fs from "node:fs/promises";
import path from "node:path";
import { readGdalMetadata } from "./gdal-metadata.js";
import type { DtmLayer } from "../types.js";

const COLOR_INTERPS = ["Red", "Green", "Blue"] as const;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatGeoTransform(geoTransform: [number, number, number, number, number, number]): string {
  return geoTransform.join(", ");
}

function buildBandXml(
  bandNumber: number,
  sourcesInXmlOrder: DtmLayer[],
  rasterXSize: number,
  rasterYSize: number
): string {
  const sourcesXml = sourcesInXmlOrder
    .map((layer) => {
      const sourcePath = escapeXml(path.normalize(layer.absolutePath));
      return [
        "    <ComplexSource>",
        `      <SourceFilename relativeToVRT="0">${sourcePath}</SourceFilename>`,
        `      <SourceBand>${bandNumber}</SourceBand>`,
        `      <SourceProperties RasterXSize="${rasterXSize}" RasterYSize="${rasterYSize}" DataType="Byte" BlockXSize="256" BlockYSize="256" />`,
        `      <SrcRect xOff="0" yOff="0" xSize="${rasterXSize}" ySize="${rasterYSize}" />`,
        `      <DstRect xOff="0" yOff="0" xSize="${rasterXSize}" ySize="${rasterYSize}" />`,
        "      <NODATA>0</NODATA>",
        "    </ComplexSource>"
      ].join("\n");
    })
    .join("\n");

  return [
    `  <VRTRasterBand dataType="Byte" band="${bandNumber}">`,
    `    <ColorInterp>${COLOR_INTERPS[bandNumber - 1]}</ColorInterp>`,
    "    <NoDataValue>0</NoDataValue>",
    sourcesXml,
    "  </VRTRasterBand>"
  ].join("\n");
}

export async function generateDtmVrt(vrtPath: string, dtmLayers: DtmLayer[]): Promise<void> {
  if (dtmLayers.length === 0) {
    throw new Error("Cannot generate a VRT without at least one DTM layer.");
  }

  const primaryLayer = dtmLayers[0];
  const metadata = await readGdalMetadata(primaryLayer.absolutePath);
  const [rasterXSize, rasterYSize] = metadata.size;
  const geoTransform = metadata.geoTransform;
  const srsWkt = metadata.coordinateSystem?.wkt;

  if (!geoTransform) {
    throw new Error(`DTM "${primaryLayer.originalName}" is missing GeoTransform metadata.`);
  }

  const bands = metadata.bands ?? [];

  if (bands.length < 3) {
    throw new Error(
      `DTM "${primaryLayer.originalName}" must expose 3 RGB bands for elevation decoding.`
    );
  }

  // The API keeps DTM layers in highest-resolution-first order for UX and downstream consumers.
  // In the VRT XML we emit lower priority sources first so the highest-priority sources appear
  // later and naturally win in GDAL overlap resolution.
  const sourcesInXmlOrder = [...dtmLayers].reverse();
  const bandXml = [1, 2, 3]
    .map((bandNumber) => buildBandXml(bandNumber, sourcesInXmlOrder, rasterXSize, rasterYSize))
    .join("\n");

  const xml = [
    `<VRTDataset rasterXSize="${rasterXSize}" rasterYSize="${rasterYSize}">`,
    `  <SRS>${escapeXml(srsWkt ?? "")}</SRS>`,
    `  <GeoTransform>${formatGeoTransform(geoTransform)}</GeoTransform>`,
    bandXml,
    "</VRTDataset>",
    ""
  ].join("\n");

  await fs.mkdir(path.dirname(vrtPath), { recursive: true });
  await fs.writeFile(vrtPath, xml, "utf8");
}
