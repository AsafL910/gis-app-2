import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { registerSwagger } from "./docs/swagger.js";
import { dtmsRouter } from "./routes/dtms.js";
import { mapsRouter } from "./routes/maps.js";
import { setsRouter } from "./routes/sets.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  registerSwagger(app);

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/api/sets", setsRouter);
  app.use("/api/maps", mapsRouter);
  app.use("/api/dtms", dtmsRouter);

  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    response.status(500).json({
      error: error.message || "Unexpected server error."
    });
  });

  return app;
}
