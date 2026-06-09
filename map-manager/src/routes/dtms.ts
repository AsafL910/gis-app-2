import { Router } from "express";
import multer from "multer";
import {
  deleteSharedDtm,
  getDownloadableSharedDtm,
  listAvailableDtms,
  renameSharedDtm,
  storeSharedDtm
} from "../services/available-dtm-service.js";

const upload = multer({ storage: multer.memoryStorage() });
export const dtmsRouter = Router();

dtmsRouter.get("/", async (_request, response) => {
  const files = await listAvailableDtms();
  response.json({ files });
});

dtmsRouter.post("/upload", upload.single("dtm"), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: "A .gpkg file is required." });
      return;
    }

    const stored = await storeSharedDtm(request.file);
    response.status(201).json({ file: stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

dtmsRouter.get("/download", async (request, response) => {
  try {
    const relativePath = typeof request.query.path === "string" ? request.query.path : "";
    const file = await getDownloadableSharedDtm(relativePath);
    response.download(file.absolutePath, file.fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

dtmsRouter.patch("/", async (request, response) => {
  try {
    const relativePath = typeof request.body?.relativePath === "string" ? request.body.relativePath : "";
    const nextFileName = typeof request.body?.nextFileName === "string" ? request.body.nextFileName : "";
    const updated = await renameSharedDtm(relativePath, nextFileName);
    response.json({ file: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to rename shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

dtmsRouter.delete("/", async (request, response) => {
  try {
    const relativePath = typeof request.query.path === "string" ? request.query.path : "";
    await deleteSharedDtm(relativePath);
    response.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

