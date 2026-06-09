const stringSchema = (example: string, description?: string) => ({
  type: "string",
  example,
  ...(description ? { description } : {})
});

const booleanSchema = (example: boolean, description?: string) => ({
  type: "boolean",
  example,
  ...(description ? { description } : {})
});

const numberSchema = (example: number, description?: string) => ({
  type: "number",
  example,
  ...(description ? { description } : {})
});

const arraySchema = (items: Record<string, unknown>, example: unknown[], description?: string) => ({
  type: "array",
  items,
  example,
  ...(description ? { description } : {})
});

const storedAssetSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stringSchema("map_01"),
    kind: {
      type: "string",
      enum: ["map", "dtm"],
      example: "map"
    },
    originalName: stringSchema("israel_rgb.gpkg"),
    storedName: stringSchema("israel_rgb.gpkg"),
    relativePath: stringSchema("sets/set-1/israel_rgb.gpkg"),
    absolutePath: stringSchema("D:/data/sets/set-1/israel_rgb.gpkg"),
    mimeType: stringSchema("application/geopackage+sqlite3"),
    size: numberSchema(12485760),
    createdAt: stringSchema("2026-06-09T09:00:00.000Z")
  },
  required: [
    "id",
    "kind",
    "originalName",
    "storedName",
    "relativePath",
    "absolutePath",
    "mimeType",
    "size",
    "createdAt"
  ]
};

const dtmLayerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...storedAssetSchema.properties,
    priority: numberSchema(0, "Layer order in the generated VRT")
  },
  required: [...storedAssetSchema.required, "priority"]
};

const mapSetRecordSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stringSchema("my-map-set"),
    name: stringSchema("My Map Set"),
    description: stringSchema("Sample set description"),
    maps: arraySchema(storedAssetSchema, [], "Uploaded or linked map files"),
    dtmLayers: arraySchema(dtmLayerSchema, [], "Ordered DTM layers"),
    vrtPath: stringSchema("D:/data/sets/my-map-set.vrt"),
    createdAt: stringSchema("2026-06-09T09:00:00.000Z"),
    updatedAt: stringSchema("2026-06-09T09:00:00.000Z")
  },
  required: ["id", "name", "maps", "dtmLayers", "vrtPath", "createdAt", "updatedAt"]
};

const availableFileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    relativePath: stringSchema("dtms/israel_top.gpkg"),
    absolutePath: stringSchema("D:/data/dtms/israel_top.gpkg"),
    fileName: stringSchema("israel_top.gpkg"),
    size: numberSchema(16777216),
    modifiedAt: stringSchema("2026-06-09T09:00:00.000Z"),
    referencedBySets: arraySchema(stringSchema("Set A"), [], "Map sets that reference this file"),
    managedBySet: booleanSchema(true, "Whether the file lives inside a managed set folder")
  },
  required: ["relativePath", "absolutePath", "fileName", "size", "modifiedAt", "referencedBySets", "managedBySet"]
};

const apiErrorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    error: stringSchema("Something went wrong.")
  },
  required: ["error"]
};

const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: booleanSchema(true)
  },
  required: ["ok"]
};

const fileUploadSchema = (fieldName: string, description: string) => ({
  type: "string",
  format: "binary",
  description: `${description} (${fieldName})`
});

const setCreateRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: stringSchema("Northern Coverage"),
    description: stringSchema("Optional description"),
    maps: {
      type: "array",
      items: fileUploadSchema("maps", "Map GeoPackage upload"),
      description: "One or more uploaded map files"
    },
    dtms: {
      type: "array",
      items: fileUploadSchema("dtms", "DTM GeoPackage upload"),
      description: "One or more uploaded DTM files"
    },
    selectedMapPaths: arraySchema(stringSchema("maps/israel_rgb.gpkg"), [], "Shared map file paths to copy into the set"),
    selectedDtmPaths: arraySchema(stringSchema("dtms/israel_top.gpkg"), [], "Shared DTM file paths to copy into the set"),
    dtmSelectionOrder: {
      type: "array",
      description: "Optional ordering of uploaded and selected DTM files",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: {
            type: "string",
            enum: ["upload", "existing"],
            example: "upload"
          },
          relativePath: stringSchema("dtms/israel_top.gpkg")
        },
        required: ["source"]
      }
    }
  },
  required: ["name"]
};

const appendAssetsRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    maps: {
      type: "array",
      items: fileUploadSchema("maps", "Map GeoPackage upload"),
      description: "One or more uploaded map files"
    },
    dtms: {
      type: "array",
      items: fileUploadSchema("dtms", "DTM GeoPackage upload"),
      description: "One or more uploaded DTM files"
    },
    selectedMapPaths: arraySchema(stringSchema("maps/israel_rgb.gpkg"), [], "Shared map file paths to copy into the set"),
    selectedDtmPaths: arraySchema(stringSchema("dtms/israel_top.gpkg"), [], "Shared DTM file paths to copy into the set"),
    dtmSelectionOrder: {
      type: "array",
      description: "Optional ordering of uploaded and selected DTM files",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: {
            type: "string",
            enum: ["upload", "existing"],
            example: "existing"
          },
          relativePath: stringSchema("dtms/israel_top.gpkg")
        },
        required: ["source"]
      }
    }
  }
};

const reorderDtmLayersRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dtmIds: arraySchema(stringSchema("dtm_01"), [], "Full desired ordering of DTM layer IDs")
  },
  required: ["dtmIds"]
};

const renameSharedFileRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    relativePath: stringSchema("dtms/israel_top.gpkg"),
    nextFileName: stringSchema("israel_top_renamed.gpkg")
  },
  required: ["relativePath", "nextFileName"]
};

export const openApiSchemas = {
  ApiError: apiErrorSchema,
  AvailableFile: availableFileSchema,
  DtmLayer: dtmLayerSchema,
  HealthResponse: healthResponseSchema,
  MapSetRecord: mapSetRecordSchema,
  RenameSharedFileRequest: renameSharedFileRequestSchema,
  SetCreateRequest: setCreateRequestSchema,
  AppendAssetsRequest: appendAssetsRequestSchema,
  ReorderDtmLayersRequest: reorderDtmLayersRequestSchema
};

