import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { setsRouter } from "./routes/sets.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/api/sets", setsRouter);

  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    response.status(500).json({
      error: error.message || "Unexpected server error."
    });
  });

  return app;
}
