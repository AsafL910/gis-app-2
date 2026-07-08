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
  listAvailableDtms,
  storeSharedDtm,
  renameSharedDtm,
  deleteSharedDtm,
  getDownloadableSharedDtm,
  resolveSharedDtm
} = await import("../../src/services/available-dtm-service.js");

const mockedListSets = listSets as jest.MockedFunction<typeof listSets>;
const mockedSaveSet = saveSet as jest.MockedFunction<typeof saveSet>;
const mockedGenerateDtmVrt = generateDtmVrt as jest.MockedFunction<typeof generateDtmVrt>;

describe("available-dtm-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.sharedDtmRoot = "/shared/dtm";
    config.setsRoot = "/managed/sets";
  });

  describe("listAvailableDtms", () => {
    it("should list available dtms and identify referencing sets", async () => {
      mockedFs.readdir.mockImplementation((dir) => {
        if (dir === "/shared/dtm") {
          return Promise.resolve([
            { name: "dtm1.gpkg", isDirectory: () => false, isFile: () => true },
            { name: "subfolder", isDirectory: () => true, isFile: () => false }
          ] as any);
        } else if (dir === path.join("/shared/dtm", "subfolder")) {
          return Promise.resolve([
            { name: "dtm2.gpkg", isDirectory: () => false, isFile: () => true }
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
          name: "Set B",
          maps: [],
          dtmLayers: [{ relativePath: "dtm1.gpkg" }]
        } as any
      ]);

      const result = await listAvailableDtms();

      expect(result).toHaveLength(2);
      
      const file1 = result.find(r => r.fileName === "dtm1.gpkg");
      expect(file1).toBeDefined();
      expect(file1?.referencedBySets).toEqual(["Set B"]);

      const file2 = result.find(r => r.fileName === "dtm2.gpkg");
      expect(file2).toBeDefined();
      expect(file2?.referencedBySets).toEqual([]);
    });
  });

  describe("storeSharedDtm", () => {
    it("should store a valid dtm file", async () => {
      mockedFs.stat.mockRejectedValueOnce({ code: "ENOENT" });
      mockedFs.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 2048,
        mtime: new Date("2023-01-01T00:00:00.000Z")
      } as any);

      const file = {
        originalname: "new-dtm.gpkg",
        mimetype: "application/geopackage+sqlite3",
        size: 2048,
        buffer: Buffer.from("data")
      };

      const result = await storeSharedDtm(file);

      expect(mockedFs.writeFile).toHaveBeenCalledWith(path.join("/shared/dtm", "new-dtm.gpkg"), file.buffer);
      expect(result.fileName).toBe("new-dtm.gpkg");
      expect(result.size).toBe(2048);
    });

    it("should throw if file already exists", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true } as any);

      const file = {
        originalname: "existing-dtm.gpkg",
        mimetype: "application/geopackage+sqlite3",
        size: 2048,
        buffer: Buffer.from("data")
      };

      await expect(storeSharedDtm(file)).rejects.toThrow('A shared GeoPackage named "existing-dtm.gpkg" already exists.');
    });

    it("should throw if extension is not .gpkg", async () => {
      const file = {
        originalname: "dtm.txt",
        mimetype: "text/plain",
        size: 10,
        buffer: Buffer.from("data")
      };

      await expect(storeSharedDtm(file)).rejects.toThrow("GeoPackage file names must end with .gpkg.");
    });
  });

  describe("renameSharedDtm", () => {
    it("should rename an existing dtm file and update sets and VRTs", async () => {
      mockedFs.stat.mockImplementation(async (filePath) => {
        const fp = filePath as string;
        if (fp.includes("old-dtm.gpkg")) {
          return { isFile: () => true, size: 1024, mtime: new Date() } as any;
        }
        if (fp.includes("new-dtm.gpkg")) {
          if (mockedFs.stat.mock.calls.length === 2) {
            throw { code: "ENOENT" };
          }
          return { isFile: () => true, size: 1024, mtime: new Date() } as any;
        }
        throw { code: "ENOENT" };
      });

      mockedListSets.mockResolvedValue([
        {
          name: "Set B",
          maps: [],
          dtmLayers: [{ relativePath: "old-dtm.gpkg", originalName: "old-dtm.gpkg", storedName: "old-dtm.gpkg", absolutePath: "/shared/dtm/old-dtm.gpkg" }],
          vrtPath: "/managed/sets/Set B/dtm.vrt"
        } as any
      ]);

      const result = await renameSharedDtm("old-dtm.gpkg", "new-dtm.gpkg");

      expect(mockedFs.rename).toHaveBeenCalledWith(path.resolve("/shared/dtm/old-dtm.gpkg"), path.join("/shared/dtm", "new-dtm.gpkg"));
      expect(mockedSaveSet).toHaveBeenCalled();
      expect(mockedGenerateDtmVrt).toHaveBeenCalled();
      expect(result.fileName).toBe("new-dtm.gpkg");
    });
  });

  describe("deleteSharedDtm", () => {
    it("should delete an existing unreferenced dtm file", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 1024, mtime: new Date() } as any);
      mockedListSets.mockResolvedValue([]);

      await deleteSharedDtm("unreferenced-dtm.gpkg");

      expect(mockedFs.rm).toHaveBeenCalledWith(path.resolve("/shared/dtm/unreferenced-dtm.gpkg"), { force: false });
    });

    it("should throw when trying to delete a non-existent dtm", async () => {
      mockedFs.stat.mockRejectedValueOnce({ code: "ENOENT" });

      await expect(deleteSharedDtm("nonexistent.gpkg")).rejects.toThrow('Shared file "nonexistent.gpkg" was not found.');
    });

    it("should throw if the dtm is referenced by a set", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 1024, mtime: new Date() } as any);
      mockedListSets.mockResolvedValue([
        {
          name: "Set B",
          maps: [],
          dtmLayers: [{ relativePath: "referenced-dtm.gpkg" }]
        } as any
      ]);

      await expect(deleteSharedDtm("referenced-dtm.gpkg")).rejects.toThrow("This GeoPackage is used by: Set B. Remove it from those sets first.");
      expect(mockedFs.rm).not.toHaveBeenCalled();
    });
  });

  describe("getDownloadableSharedDtm", () => {
    it("should return absolute path and filename", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 1024, mtime: new Date() } as any);

      const result = await getDownloadableSharedDtm("test.gpkg");

      expect(result.fileName).toBe("test.gpkg");
      expect(result.absolutePath).toBe(path.resolve("/shared/dtm/test.gpkg"));
    });
  });

  describe("resolveSharedDtm", () => {
    it("should return absolute path, filename, and size", async () => {
      mockedFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 5000, mtime: new Date() } as any);

      const result = await resolveSharedDtm("test.gpkg");

      expect(result.fileName).toBe("test.gpkg");
      expect(result.absolutePath).toBe(path.resolve("/shared/dtm/test.gpkg"));
      expect(result.size).toBe(5000);
    });
  });
});
