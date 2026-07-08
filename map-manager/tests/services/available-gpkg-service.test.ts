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

jest.unstable_mockModule("../../src/services/manifest-store.js", () => ({
  listSets: jest.fn(),
  saveSet: jest.fn()
}));

jest.unstable_mockModule("../../src/services/vrt-builder.js", () => ({
  generateDtmVrt: jest.fn()
}));

const fs = (await import("node:fs/promises")).default;
const path = (await import("node:path")).default;
const { config } = await import("../../src/config.js");
const { listSets, saveSet } = await import("../../src/services/manifest-store.js");
const { generateDtmVrt } = await import("../../src/services/vrt-builder.js");
const {
  listAvailableGpkgs,
  storeSharedGpkg,
  renameSharedGpkg,
  deleteSharedGpkg,
  getDownloadableSharedGpkg,
  resolveSharedGpkg
} = await import("../../src/services/available-gpkg-service.js");

const mockedListSets = listSets as jest.MockedFunction<typeof listSets>;
const mockedSaveSet = saveSet as jest.MockedFunction<typeof saveSet>;

describe("available-gpkg-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.sharedDataRoot = "/shared/data";
    config.setsRoot = "/managed/sets";
  });

  describe("listAvailableGpkgs", () => {
    it("should list available gpkgs and identify referencing sets", async () => {
      mockedFs.readdir.mockImplementation((dir) => {
        if (dir === "/shared/data") {
          return Promise.resolve([
            { name: "test1.gpkg", isDirectory: () => false, isFile: () => true },
            { name: "subfolder", isDirectory: () => true, isFile: () => false }
          ] as any);
        } else if (dir === path.join("/shared/data", "subfolder")) {
          return Promise.resolve([
            { name: "test2.gpkg", isDirectory: () => false, isFile: () => true }
          ] as any);
        }
        return Promise.resolve([] as any);
      });

      mockedFs.stat.mockResolvedValue({
        size: 1024,
        mtime: new Date("2023-01-01T00:00:00.000Z")
      } as any);

      mockedListSets.mockResolvedValue([
        {
          name: "Set A",
          maps: [{ relativePath: "test1.gpkg" }],
          dtmLayers: []
        } as any
      ]);

      const result = await listAvailableGpkgs();

      expect(result).toHaveLength(2);
      
      const file1 = result.find(r => r.fileName === "test1.gpkg");
      expect(file1).toBeDefined();
      expect(file1?.referencedBySets).toEqual(["Set A"]);

      const file2 = result.find(r => r.fileName === "test2.gpkg");
      expect(file2).toBeDefined();
      expect(file2?.referencedBySets).toEqual([]);
    });
  });

  describe("storeSharedGpkg", () => {
    it("should store a valid gpkg file", async () => {
      mockedFs.stat.mockRejectedValueOnce({ code: "ENOENT" });
      mockedFs.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 2048,
        mtime: new Date("2023-01-01T00:00:00.000Z")
      } as any);

      const file = {
        originalname: "new-map.gpkg",
        mimetype: "application/geopackage+sqlite3",
        size: 2048,
        buffer: Buffer.from("data")
      };

      const result = await storeSharedGpkg(file);

      expect(mockedFs.writeFile).toHaveBeenCalledWith(path.join("/shared/data", "new-map.gpkg"), file.buffer);
      expect(result.fileName).toBe("new-map.gpkg");
      expect(result.size).toBe(2048);
    });

    it("should throw if trying to store into managed sets folder", async () => {
      config.sharedDataRoot = "/managed/sets/shared";
      const file = {
        originalname: "new-map.gpkg",
        mimetype: "application/geopackage+sqlite3",
        size: 2048,
        buffer: Buffer.from("data")
      };

      await expect(storeSharedGpkg(file)).rejects.toThrow("Shared GeoPackages cannot be uploaded into the managed sets folder.");
    });

    it("should throw if file already exists", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true } as any);

      const file = {
        originalname: "existing.gpkg",
        mimetype: "application/geopackage+sqlite3",
        size: 2048,
        buffer: Buffer.from("data")
      };

      await expect(storeSharedGpkg(file)).rejects.toThrow('A shared GeoPackage named "existing.gpkg" already exists.');
    });

    it("should throw if extension is not .gpkg", async () => {
      const file = {
        originalname: "map.txt",
        mimetype: "text/plain",
        size: 10,
        buffer: Buffer.from("data")
      };

      await expect(storeSharedGpkg(file)).rejects.toThrow("GeoPackage file names must end with .gpkg.");
    });
  });

  describe("renameSharedGpkg", () => {
    it("should rename an existing gpkg file", async () => {
      mockedFs.stat.mockImplementation(async (filePath) => {
        const fp = filePath as string;
        if (fp.includes("old.gpkg")) {
          return { isFile: () => true, size: 1024, mtime: new Date() } as any;
        }
        if (fp.includes("new.gpkg")) {
          if (mockedFs.stat.mock.calls.length === 2) {
            throw { code: "ENOENT" };
          }
          return { isFile: () => true, size: 1024, mtime: new Date() } as any;
        }
        throw { code: "ENOENT" };
      });

      mockedListSets.mockResolvedValue([
        {
          name: "Set A",
          maps: [{ relativePath: "old.gpkg", originalName: "old.gpkg", storedName: "old.gpkg", absolutePath: "/shared/data/old.gpkg" }],
          dtmLayers: [],
          vrtPath: "/managed/sets/Set A/dtm.vrt"
        } as any
      ]);

      const result = await renameSharedGpkg("old.gpkg", "new.gpkg");

      expect(mockedFs.rename).toHaveBeenCalledWith(path.resolve("/shared/data/old.gpkg"), path.join("/shared/data", "new.gpkg"));
      expect(mockedSaveSet).toHaveBeenCalled();
      expect(result.fileName).toBe("new.gpkg");
    });

    it("should throw if new name is identical to old name", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 1024, mtime: new Date() } as any);
      await expect(renameSharedGpkg("same.gpkg", "same.gpkg")).rejects.toThrow("Choose a different file name before saving.");
    });
  });

  describe("deleteSharedGpkg", () => {
    it("should delete an existing unreferenced gpkg file", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 1024, mtime: new Date() } as any);
      mockedListSets.mockResolvedValue([]);

      await deleteSharedGpkg("unreferenced.gpkg");

      expect(mockedFs.rm).toHaveBeenCalledWith(path.resolve("/shared/data/unreferenced.gpkg"), { force: false });
    });

    it("should throw when trying to delete a non-existent map", async () => {
      mockedFs.stat.mockRejectedValueOnce({ code: "ENOENT" });

      await expect(deleteSharedGpkg("nonexistent.gpkg")).rejects.toThrow('Shared file "nonexistent.gpkg" was not found.');
    });

    it("should throw if the file is referenced by a set", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 1024, mtime: new Date() } as any);
      mockedListSets.mockResolvedValue([
        {
          name: "Set A",
          maps: [{ relativePath: "referenced.gpkg" }],
          dtmLayers: []
        } as any
      ]);

      await expect(deleteSharedGpkg("referenced.gpkg")).rejects.toThrow("This GeoPackage is used by: Set A. Remove it from those sets first.");
      expect(mockedFs.rm).not.toHaveBeenCalled();
    });
  });

  describe("getDownloadableSharedGpkg", () => {
    it("should return absolute path and filename", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 1024, mtime: new Date() } as any);

      const result = await getDownloadableSharedGpkg("test.gpkg");

      expect(result.fileName).toBe("test.gpkg");
      expect(result.absolutePath).toBe(path.resolve("/shared/data/test.gpkg"));
    });
  });

  describe("resolveSharedGpkg", () => {
    it("should return absolute path, filename, and size", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 5000, mtime: new Date() } as any);

      const result = await resolveSharedGpkg("test.gpkg");

      expect(result.fileName).toBe("test.gpkg");
      expect(result.absolutePath).toBe(path.resolve("/shared/data/test.gpkg"));
      expect(result.size).toBe(5000);
    });
  });
});
