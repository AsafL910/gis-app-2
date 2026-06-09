import { OPENAPI_DESCRIPTION, OPENAPI_TITLE, OPENAPI_VERSION } from "./constants.js";
import { openApiSchemas } from "./schemas.js";

export function createOpenApiDocument() {
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: OPENAPI_TITLE,
      version: "0.1.0",
      description: OPENAPI_DESCRIPTION
    },
    tags: [
      { name: "Health", description: "Service status checks" },
      { name: "Sets", description: "Map set lifecycle and asset management" },
      { name: "Maps", description: "Shared map GeoPackage library endpoints" },
      { name: "DTMs", description: "Shared DTM GeoPackage library endpoints" }
    ],
    servers: [{ url: "/" }],
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          operationId: "getHealth",
          responses: {
            200: {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: openApiSchemas.HealthResponse
                }
              }
            }
          }
        }
      },
      "/api/maps": {
        get: {
          tags: ["Maps"],
          summary: "List shared maps",
          operationId: "listSharedGpkgs",
          responses: {
            200: {
              description: "Shared GeoPackages",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      files: {
                        type: "array",
                        items: openApiSchemas.AvailableFile
                      }
                    },
                    required: ["files"]
                  }
                }
              }
            }
          }
        },
        patch: {
          tags: ["Maps"],
          summary: "Rename a shared map",
          operationId: "renameSharedGpkg",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: openApiSchemas.RenameSharedFileRequest
              }
            }
          },
          responses: {
            200: {
              description: "Updated file metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      file: openApiSchemas.AvailableFile
                    },
                    required: ["file"]
                  }
                }
              }
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        },
        delete: {
          tags: ["Maps"],
          summary: "Delete a shared map",
          operationId: "deleteSharedGpkg",
          parameters: [
            {
              name: "path",
              in: "query",
              required: true,
              schema: {
                type: "string",
                example: "maps/israel_rgb.gpkg"
              }
            }
          ],
          responses: {
            204: {
              description: "Deleted successfully"
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      },
      "/api/maps/upload": {
        post: {
          tags: ["Maps"],
          summary: "Upload a shared map",
          operationId: "uploadSharedGpkg",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    gpkg: {
                      type: "string",
                      format: "binary"
                    }
                  },
                  required: ["gpkg"]
                }
              }
            }
          },
          responses: {
            201: {
              description: "Uploaded file metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      file: openApiSchemas.AvailableFile
                    },
                    required: ["file"]
                  }
                }
              }
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      },
      "/api/maps/download": {
        get: {
          tags: ["Maps"],
          summary: "Download a shared map",
          operationId: "downloadSharedGpkg",
          parameters: [
            {
              name: "path",
              in: "query",
              required: true,
              schema: {
                type: "string",
                example: "maps/israel_rgb.gpkg"
              }
            }
          ],
          responses: {
            200: {
              description: "Binary file download"
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      },
      "/api/dtms": {
        get: {
          tags: ["DTMs"],
          summary: "List shared DTMs",
          operationId: "listSharedDtms",
          responses: {
            200: {
              description: "Shared DTM GeoPackages",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      files: {
                        type: "array",
                        items: openApiSchemas.AvailableFile
                      }
                    },
                    required: ["files"]
                  }
                }
              }
            }
          }
        },
        patch: {
          tags: ["DTMs"],
          summary: "Rename a shared DTM",
          operationId: "renameSharedDtm",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: openApiSchemas.RenameSharedFileRequest
              }
            }
          },
          responses: {
            200: {
              description: "Updated file metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      file: openApiSchemas.AvailableFile
                    },
                    required: ["file"]
                  }
                }
              }
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        },
        delete: {
          tags: ["DTMs"],
          summary: "Delete a shared DTM",
          operationId: "deleteSharedDtm",
          parameters: [
            {
              name: "path",
              in: "query",
              required: true,
              schema: {
                type: "string",
                example: "dtms/israel_top.gpkg"
              }
            }
          ],
          responses: {
            204: {
              description: "Deleted successfully"
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      },
      "/api/dtms/upload": {
        post: {
          tags: ["DTMs"],
          summary: "Upload a shared DTM",
          operationId: "uploadSharedDtm",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    dtm: {
                      type: "string",
                      format: "binary"
                    }
                  },
                  required: ["dtm"]
                }
              }
            }
          },
          responses: {
            201: {
              description: "Uploaded file metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      file: openApiSchemas.AvailableFile
                    },
                    required: ["file"]
                  }
                }
              }
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      },
      "/api/dtms/download": {
        get: {
          tags: ["DTMs"],
          summary: "Download a shared DTM",
          operationId: "downloadSharedDtm",
          parameters: [
            {
              name: "path",
              in: "query",
              required: true,
              schema: {
                type: "string",
                example: "dtms/israel_top.gpkg"
              }
            }
          ],
          responses: {
            200: {
              description: "Binary file download"
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      },
      "/api/sets": {
        get: {
          tags: ["Sets"],
          summary: "List map sets",
          operationId: "listSets",
          responses: {
            200: {
              description: "Map sets",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      sets: {
                        type: "array",
                        items: openApiSchemas.MapSetRecord
                      }
                    },
                    required: ["sets"]
                  }
                }
              }
            }
          }
        },
        post: {
          tags: ["Sets"],
          summary: "Create a map set",
          operationId: "createSet",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: openApiSchemas.SetCreateRequest
              }
            }
          },
          responses: {
            201: {
              description: "Created map set",
              content: {
                "application/json": {
                  schema: openApiSchemas.MapSetRecord
                }
              }
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      },
      "/api/sets/{id}/assets": {
        post: {
          tags: ["Sets"],
          summary: "Append assets to a map set",
          operationId: "appendAssetsToSet",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
                example: "my-map-set"
              }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: openApiSchemas.AppendAssetsRequest
              }
            }
          },
          responses: {
            200: {
              description: "Updated map set",
              content: {
                "application/json": {
                  schema: openApiSchemas.MapSetRecord
                }
              }
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      },
      "/api/sets/{id}/dtm-order": {
        put: {
          tags: ["Sets"],
          summary: "Reorder the DTM layers for a set",
          operationId: "reorderDtmLayers",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
                example: "my-map-set"
              }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: openApiSchemas.ReorderDtmLayersRequest
              }
            }
          },
          responses: {
            200: {
              description: "Updated map set",
              content: {
                "application/json": {
                  schema: openApiSchemas.MapSetRecord
                }
              }
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      },
      "/api/sets/{id}": {
        delete: {
          tags: ["Sets"],
          summary: "Delete a map set",
          operationId: "deleteSet",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
                example: "my-map-set"
              }
            }
          ],
          responses: {
            204: {
              description: "Deleted successfully"
            },
            404: {
              description: "Set not found",
              content: {
                "application/json": {
                  schema: openApiSchemas.ApiError
                }
              }
            }
          }
        }
      }
    }
  };
}
