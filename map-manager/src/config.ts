import path from "node:path";

const serviceRoot = process.cwd();
const workspaceRoot = path.resolve(serviceRoot, "..");
const sharedDataRoot = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(workspaceRoot, "data");

export const config = {
  port: Number(process.env.PORT ?? 4002),
  workspaceRoot,
  sharedDataRoot,
  sharedDtmRoot: path.join(sharedDataRoot, "dtms"),
  setsManifestPath: path.join(sharedDataRoot, "sets.json"),
  setsRoot: path.join(sharedDataRoot, "sets")
};
