import { Router } from "express";
import multer from "multer";
import { listAvailableGpkgs } from "../services/available-gpkg-service.js";
import { createSet, getAllSets, removeSet, reorderDtmLayers } from "../services/set-service.js";

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

setsRouter.get("/available-gpkgs", async (_request, response) => {
  const files = await listAvailableGpkgs();
  response.json({ files });
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

setsRouter.put("/:id/dtm-order", async (request, response) => {
  try {
    const dtmIds = Array.isArray(request.body?.dtmIds) ? request.body.dtmIds : null;

    if (!dtmIds || !dtmIds.every((value: unknown) => typeof value === "string")) {
      response.status(400).json({ error: "Body must include dtmIds: string[]" });
      return;
    }

    const updated = await reorderDtmLayers(request.params.id, dtmIds);
    response.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reorder DTM layers.";
    response.status(400).json({ error: message });
  }
});

setsRouter.delete("/:id", async (request, response) => {
  const deleted = await removeSet(request.params.id);

  if (!deleted) {
    response.status(404).json({ error: "Map set not found." });
    return;
  }

  response.status(204).send();
});
