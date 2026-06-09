import { Router } from "express";
import multer from "multer";
import {
  deleteSharedGpkg,
  getDownloadableSharedGpkg,
  listAvailableGpkgs,
  renameSharedGpkg,
  storeSharedGpkg
} from "../services/available-gpkg-service.js";
import {
  deleteSharedDtm,
  getDownloadableSharedDtm,
  listAvailableDtms,
  renameSharedDtm,
  storeSharedDtm
} from "../services/available-dtm-service.js";
import { appendAssetsToSet, createSet, getAllSets, removeSet, reorderDtmLayers } from "../services/set-service.js";

const upload = multer({ storage: multer.memoryStorage() });
export const setsRouter = Router();

function parseStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [value];
    }
  }

  return [];
}

function parseDtmSelectionOrder(
  value: unknown
): Array<{ source: "upload" | "existing"; relativePath?: string }> {
  if (!value || typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const source = "source" in item ? item.source : undefined;
      const relativePath = "relativePath" in item ? item.relativePath : undefined;

      if (source !== "upload" && source !== "existing") {
        return [];
      }

      return [
        {
          source,
          relativePath: typeof relativePath === "string" ? relativePath : undefined
        }
      ];
    });
  } catch {
    return [];
  }
}

function readRouteId(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

setsRouter.get("/available-gpkgs", async (_request, response) => {
  const files = await listAvailableGpkgs();
  response.json({ files });
});

setsRouter.post("/available-gpkgs/upload", upload.single("gpkg"), async (request, response) => {
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

setsRouter.get("/available-gpkgs/download", async (request, response) => {
  try {
    const relativePath = typeof request.query.path === "string" ? request.query.path : "";
    const file = await getDownloadableSharedGpkg(relativePath);
    response.download(file.absolutePath, file.fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

setsRouter.patch("/available-gpkgs", async (request, response) => {
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

setsRouter.delete("/available-gpkgs", async (request, response) => {
  try {
    const relativePath = typeof request.query.path === "string" ? request.query.path : "";
    await deleteSharedGpkg(relativePath);
    response.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

setsRouter.get("/available-dtms", async (_request, response) => {
  const files = await listAvailableDtms();
  response.json({ files });
});

setsRouter.post("/available-dtms/upload", upload.single("dtm"), async (request, response) => {
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

setsRouter.get("/available-dtms/download", async (request, response) => {
  try {
    const relativePath = typeof request.query.path === "string" ? request.query.path : "";
    const file = await getDownloadableSharedDtm(relativePath);
    response.download(file.absolutePath, file.fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

setsRouter.patch("/available-dtms", async (request, response) => {
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

setsRouter.delete("/available-dtms", async (request, response) => {
  try {
    const relativePath = typeof request.query.path === "string" ? request.query.path : "";
    await deleteSharedDtm(relativePath);
    response.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete shared GeoPackage.";
    response.status(400).json({ error: message });
  }
});

setsRouter.get("/", async (_request, response) => {
  const sets = await getAllSets();
  response.json({ sets });
});

setsRouter.post(
  "/",
  upload.fields([
    { name: "maps", maxCount: 100 },
    { name: "dtms", maxCount: 100 }
  ]),
  async (request, response) => {
    try {
      const files = request.files as Record<string, Express.Multer.File[]> | undefined;
      const maps = files?.maps ?? [];
      const dtms = files?.dtms ?? [];

      const created = await createSet({
        name: String(request.body.name ?? ""),
        description: request.body.description ? String(request.body.description) : undefined,
        maps,
        dtms,
        selectedMapPaths: parseStringArray(request.body.selectedMapPaths),
        selectedDtmPaths: parseStringArray(request.body.selectedDtmPaths),
        dtmSelectionOrder: parseDtmSelectionOrder(request.body.dtmSelectionOrder)
      });

      response.status(201).json(created);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create map set.";
      response.status(400).json({ error: message });
    }
  }
);

setsRouter.post(
  "/:id/assets",
  upload.fields([
    { name: "maps", maxCount: 100 },
    { name: "dtms", maxCount: 100 }
  ]),
  async (request, response) => {
    try {
      const files = request.files as Record<string, Express.Multer.File[]> | undefined;
      const maps = files?.maps ?? [];
      const dtms = files?.dtms ?? [];

      const updated = await appendAssetsToSet(readRouteId(request.params.id), {
        maps,
        dtms,
        selectedMapPaths: parseStringArray(request.body.selectedMapPaths),
        selectedDtmPaths: parseStringArray(request.body.selectedDtmPaths),
        dtmSelectionOrder: parseDtmSelectionOrder(request.body.dtmSelectionOrder)
      });

      response.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add assets to map set.";
      response.status(400).json({ error: message });
    }
  }
);

setsRouter.put("/:id/dtm-order", async (request, response) => {
  try {
    const dtmIds = Array.isArray(request.body?.dtmIds) ? request.body.dtmIds : null;

    if (!dtmIds || !dtmIds.every((value: unknown) => typeof value === "string")) {
      response.status(400).json({ error: "Body must include dtmIds: string[]" });
      return;
    }

    const updated = await reorderDtmLayers(readRouteId(request.params.id), dtmIds);
    response.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reorder DTM layers.";
    response.status(400).json({ error: message });
  }
});

setsRouter.delete("/:id", async (request, response) => {
  const deleted = await removeSet(readRouteId(request.params.id));

  if (!deleted) {
    response.status(404).json({ error: "Map set not found." });
    return;
  }

  response.status(204).send();
});
