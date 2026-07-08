import type { Express, NextFunction, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { createOpenApiDocument } from "./openapi/document.js";

const openApiDocument = createOpenApiDocument();

function serveOpenApiDocument(_request: Request, response: Response, next: NextFunction): void {
  try {
    response.json(openApiDocument);
  } catch (error) {
    next(error);
  }
}

export function registerSwagger(app: Express): void {
  app.get("/openapi.json", serveOpenApiDocument);
  app.get("/api/v1/openapi.json", serveOpenApiDocument);
  app.use("/docs", swaggerUi.serve);
  app.use("/api/v1/docs", swaggerUi.serve);
  app.get(
    "/docs",
    swaggerUi.setup(openApiDocument, {
      explorer: true,
      customSiteTitle: "Map Manager API Docs",
      swaggerOptions: {
        url: "/openapi.json"
      }
    })
  );
  app.get(
    "/api/v1/docs",
    swaggerUi.setup(openApiDocument, {
      explorer: true,
      customSiteTitle: "Map Manager API Docs",
      swaggerOptions: {
        url: "/api/v1/openapi.json"
      }
    })
  );
}
