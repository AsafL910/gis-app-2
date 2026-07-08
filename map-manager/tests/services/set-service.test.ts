import { jest } from "@jest/globals";
import type * as FsPromises from "node:fs/promises";

const mockedFs = {
  readdir: jest.fn() as unknown as jest.MockedFunction<typeof FsPromises.readdir>,
  stat: jest.fn() as unknown as jest.MockedFunction<typeof FsPromises.stat>,
  writeFile: jest.fn() as unknown as jest.MockedFunction<typeof FsPromises.writeFile>,
  rename: jest.fn() as unknown as jest.MockedFunction<typeof FsPromises.rename>,
  rm: jest.fn() as unknown as jest.MockedFunction<typeof FsPromises.rm>
};

jest.unstable_mockModule("node:fs/promises", () => ({
  default: mockedFs
}));

jest.unstable_mockModule("../../src/utils/id.js", () => ({
  createId: jest.fn()
}));

jest.unstable_mockModule("../../src/services/available-gpkg-service.js", () => ({
  storeSharedGpkg: jest.fn(),
  resolveSharedGpkg: jest.fn(),
  renameSharedGpkg: jest.fn(),
  deleteSharedGpkg: jest.fn(),
  getDownloadableSharedGpkg: jest.fn(),
  listAvailableGpkgs: jest.fn()
}));

jest.unstable_mockModule("../../src/services/available-dtm-service.js", () => ({
  storeSharedDtm: jest.fn(),
  resolveSharedDtm: jest.fn(),
  renameSharedDtm: jest.fn(),
  deleteSharedDtm: jest.fn(),
  getDownloadableSharedDtm: jest.fn(),
  listAvailableDtms: jest.fn()
}));

jest.unstable_mockModule("../../src/services/manifest-store.js", () => ({
  deleteSetRecord: jest.fn(),
  getSetOrThrow: jest.fn(),
  listSets: jest.fn(),
  saveSet: jest.fn()
}));

jest.unstable_mockModule("../../src/services/vrt-builder.js", () => ({
  generateDtmVrt: jest.fn()
}));

jest.unstable_mockModule("../../src/services/set-paths.js", () => ({
  buildSetKey: jest.fn(),
  buildSetVrtPath: jest.fn()
}));

const fs = (await import("node:fs/promises")).default;
const path = (await import("node:path")).default;
const { config } = await import("../../src/config.js");
const { createId } = await import("../../src/utils/id.js");
const { storeSharedGpkg, resolveSharedGpkg } = await import("../../src/services/available-gpkg-service.js");
const { storeSharedDtm, resolveSharedDtm } = await import("../../src/services/available-dtm-service.js");
const { deleteSetRecord, getSetOrThrow, listSets, saveSet } = await import("../../src/services/manifest-store.js");
const { generateDtmVrt } = await import("../../src/services/vrt-builder.js");
const { buildSetKey, buildSetVrtPath } = await import("../../src/services/set-paths.js");
const { getAllSets, createSet, appendAssetsToSet, reorderDtmLayers, removeSet } = await import("../../src/services/set-service.js");

const mockedCreateId = createId as jest.MockedFunction<typeof createId>;
const mockedStoreSharedGpkg = storeSharedGpkg as jest.MockedFunction<typeof storeSharedGpkg>;
const mockedResolveSharedGpkg = resolveSharedGpkg as jest.MockedFunction<typeof resolveSharedGpkg>;
const mockedStoreSharedDtm = storeSharedDtm as jest.MockedFunction<typeof storeSharedDtm>;
const mockedResolveSharedDtm = resolveSharedDtm as jest.MockedFunction<typeof resolveSharedDtm>;
const mockedListSets = listSets as jest.MockedFunction<typeof listSets>;
const mockedGetSetOrThrow = getSetOrThrow as jest.MockedFunction<typeof getSetOrThrow>;
const mockedSaveSet = saveSet as jest.MockedFunction<typeof saveSet>;
const mockedDeleteSetRecord = deleteSetRecord as jest.MockedFunction<typeof deleteSetRecord>;
const mockedGenerateDtmVrt = generateDtmVrt as jest.MockedFunction<typeof generateDtmVrt>;
const mockedBuildSetKey = buildSetKey as jest.MockedFunction<typeof buildSetKey>;
const mockedBuildSetVrtPath = buildSetVrtPath as jest.MockedFunction<typeof buildSetVrtPath>;

describe("set-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.setsRoot = "/managed/sets";
    mockedCreateId.mockReturnValue("mock-id");
    mockedBuildSetKey.mockImplementation((name) => name.toLowerCase().replace(/\\s+/g, "-"));
    mockedBuildSetVrtPath.mockImplementation((root, name) => path.join(root, name, "dtm.vrt"));
  });

  describe("getAllSets", () => {
    it("should return all sets", async () => {
      mockedListSets.mockResolvedValue([{ name: "Set 1" } as any]);
      const sets = await getAllSets();
      expect(sets).toEqual([{ name: "Set 1" }]);
    });
  });

  describe("createSet", () => {
    it("should throw if name is empty", async () => {
      await expect(
        createSet({ name: "   ", maps: [], dtms: [] })
      ).rejects.toThrow("Map set name is required.");
    });

    it("should throw if no maps are provided", async () => {
      await expect(
        createSet({ name: "Set 1", maps: [], dtms: [], selectedMapPaths: [] })
      ).rejects.toThrow("At least one map file is required.");
    });

    it("should throw if set already exists", async () => {
      mockedGetSetOrThrow.mockResolvedValueOnce({} as any); // Set exists

      await expect(
        createSet({
          name: "Existing Set",
          maps: [{ originalname: "map.gpkg", buffer: Buffer.from(""), size: 10, mimetype: "" }],
          dtms: []
        })
      ).rejects.toThrow('A map set named "Existing Set" already exists.');
    });

    it("should create a set with uploaded maps and dtms", async () => {
      mockedGetSetOrThrow.mockRejectedValueOnce(new Error("Not found")); // Set does not exist
      mockedStoreSharedGpkg.mockResolvedValue({
        fileName: "stored-map.gpkg",
        relativePath: "stored-map.gpkg",
        absolutePath: "/shared/stored-map.gpkg",
        size: 10,
        modifiedAt: "now",
        referencedBySets: [],
        managedBySet: false
      });
      mockedSaveSet.mockImplementation(async (set) => set);

      const result = await createSet({
        name: "New Set",
        description: "A new set",
        maps: [{ originalname: "map.gpkg", buffer: Buffer.from(""), size: 10, mimetype: "" }],
        dtms: []
      });

      expect(result.name).toBe("New Set");
      expect(result.description).toBe("A new set");
      expect(result.maps).toHaveLength(1);
      expect(result.dtmLayers).toHaveLength(0);
      expect(mockedSaveSet).toHaveBeenCalled();
    });

    it("should generate DTM VRT when dtms are provided", async () => {
      mockedGetSetOrThrow.mockRejectedValueOnce(new Error("Not found"));
      mockedResolveSharedGpkg.mockResolvedValue({
        fileName: "some-map.gpkg",
        absolutePath: "/shared/some-map.gpkg",
        size: 10
      });
      mockedResolveSharedDtm.mockResolvedValue({
        fileName: "dtm.gpkg",
        absolutePath: "/shared/dtm.gpkg",
        size: 10
      });
      mockedSaveSet.mockImplementation(async (set) => set);

      await createSet({
        name: "Dtm Set",
        maps: [],
        selectedMapPaths: ["some-map.gpkg"],
        dtms: [],
        selectedDtmPaths: ["dtm.gpkg"]
      });

      expect(mockedGenerateDtmVrt).toHaveBeenCalled();
      expect(mockedSaveSet).toHaveBeenCalled();
    });
  });

  describe("appendAssetsToSet", () => {
    it("should throw if no assets provided", async () => {
      mockedGetSetOrThrow.mockResolvedValueOnce({ name: "Set 1", maps: [], dtmLayers: [] } as any);
      await expect(appendAssetsToSet("set-1", { maps: [], dtms: [] })).rejects.toThrow("Choose at least one map or DTM file to add.");
    });

    it("should throw if map already exists in set", async () => {
      mockedGetSetOrThrow.mockResolvedValueOnce({
        name: "Set 1",
        maps: [{ relativePath: "dup-map.gpkg" }],
        dtmLayers: []
      } as any);

      await expect(
        appendAssetsToSet("set-1", {
          maps: [],
          dtms: [],
          selectedMapPaths: ["dup-map.gpkg"]
        })
      ).rejects.toThrow('Map "dup-map.gpkg" is already part of set "Set 1".');
    });

    it("should append assets and save set", async () => {
      mockedGetSetOrThrow.mockResolvedValueOnce({
        name: "Set 1",
        maps: [],
        dtmLayers: [],
        vrtPath: "/managed/sets/Set 1/dtm.vrt"
      } as any);
      mockedResolveSharedGpkg.mockResolvedValue({ fileName: "map.gpkg", absolutePath: "", size: 10 });
      mockedSaveSet.mockImplementation(async (set) => set);

      const result = await appendAssetsToSet("set-1", {
        maps: [],
        dtms: [],
        selectedMapPaths: ["map.gpkg"]
      });

      expect(result.maps).toHaveLength(1);
      expect(mockedSaveSet).toHaveBeenCalled();
    });
  });

  describe("reorderDtmLayers", () => {
    it("should throw if provided order has missing layers", async () => {
      mockedGetSetOrThrow.mockResolvedValueOnce({
        dtmLayers: [{ id: "l1" }, { id: "l2" }]
      } as any);
      await expect(reorderDtmLayers("set-1", ["l1"])).rejects.toThrow("The provided DTM order must include every existing DTM layer exactly once.");
    });

    it("should throw if provided order has invalid IDs", async () => {
      mockedGetSetOrThrow.mockResolvedValueOnce({
        id: "set-1",
        dtmLayers: [{ id: "l1" }, { id: "l2" }]
      } as any);
      await expect(reorderDtmLayers("set-1", ["l1", "invalid"])).rejects.toThrow('DTM layer "invalid" does not belong to set "set-1".');
    });

    it("should throw if provided order has duplicate IDs", async () => {
      mockedGetSetOrThrow.mockResolvedValueOnce({
        id: "set-1",
        dtmLayers: [{ id: "l1" }, { id: "l2" }]
      } as any);
      await expect(reorderDtmLayers("set-1", ["l1", "l1"])).rejects.toThrow("The provided DTM order contains duplicate IDs.");
    });

    it("should reorder successfully", async () => {
      mockedGetSetOrThrow.mockResolvedValueOnce({
        id: "set-1",
        dtmLayers: [{ id: "l1", priority: 0 }, { id: "l2", priority: 1 }],
        vrtPath: "/vrt"
      } as any);
      mockedSaveSet.mockImplementation(async (set) => set);

      const result = await reorderDtmLayers("set-1", ["l2", "l1"]);
      expect(result.dtmLayers.find(l => l.id === "l2")?.priority).toBe(0);
      expect(result.dtmLayers.find(l => l.id === "l1")?.priority).toBe(1);
      expect(mockedGenerateDtmVrt).toHaveBeenCalled();
    });
  });

  describe("removeSet", () => {
    it("should return null if set id does not exist", async () => {
      mockedDeleteSetRecord.mockResolvedValueOnce(null);

      const result = await removeSet("non-existent-set");
      expect(result).toBeNull();
      expect(mockedFs.rm).not.toHaveBeenCalled();
    });

    it("should delete the parent directory if it is inside the sets root", async () => {
      mockedDeleteSetRecord.mockResolvedValueOnce({
        vrtPath: path.join("/managed/sets", "Set A", "dtm.vrt")
      } as any);

      const result = await removeSet("set-a");
      expect(result).not.toBeNull();
      expect(mockedFs.rm).toHaveBeenCalledWith(path.resolve("/managed/sets", "Set A"), { recursive: true, force: true });
    });

    it("should delete just the VRT file if parent is sets root", async () => {
      mockedDeleteSetRecord.mockResolvedValueOnce({
        vrtPath: path.join("/managed/sets", "dtm.vrt")
      } as any);

      const result = await removeSet("set-root");
      expect(result).not.toBeNull();
      expect(mockedFs.rm).toHaveBeenCalledWith(path.resolve("/managed/sets", "dtm.vrt"), { force: true });
    });

    it("should refuse to delete a VRT path outside the managed sets root", async () => {
      mockedDeleteSetRecord.mockResolvedValueOnce({
        vrtPath: path.join("/outside", "escape.vrt")
      } as any);

      await expect(removeSet("escaped-set")).rejects.toThrow(
        /Refusing to delete VRT path outside the managed sets folder/
      );
      expect(mockedFs.rm).not.toHaveBeenCalled();
    });
  });
});
