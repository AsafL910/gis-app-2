import { Router } from "express";
import multer from "multer";
import {
  deleteSharedGpkg,
  getDownloadableSharedGpkg,
  listAvailableGpkgs,
  renameSharedGpkg,
  storeSharedGpkg
} from "../services/available-gpkg-service.js";

const upload = multer({ storage: multer.memoryStorage() });
export const mapsRouter = Router();

mapsRouter.get("/", async (_request, response) => {
  const files = await listAvailableGpkgs();
  response.json({ files });
});

mapsRouter.post("/upload", upload.single("gpkg"), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: "A .gpkg file is required." });
      return;
    }

    const stored = await storeSharedGpkg(request.file);
    response.status(201).json({ file: stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

mapsRouter.get("/download", async (request, response) => {
  try {
    const relativePath = typeof request.query.path === "string" ? request.query.path : "";
    const file = await getDownloadableSharedGpkg(relativePath);
    response.download(file.absolutePath, file.fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

mapsRouter.patch("/", async (request, response) => {
  try {
    const relativePath = typeof request.body?.relativePath === "string" ? request.body.relativePath : "";
    const nextFileName = typeof request.body?.nextFileName === "string" ? request.body.nextFileName : "";
    const updated = await renameSharedGpkg(relativePath, nextFileName);
    response.json({ file: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to rename shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

mapsRouter.delete("/", async (request, response) => {
  try {
    const relativePath = typeof request.query.path === "string" ? request.query.path : "";
    await deleteSharedGpkg(relativePath);
    response.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

