import path from "node:path";

export function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const resolvedParent = path.resolve(parentPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedParent, resolvedCandidate);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertPathWithin(parentPath: string, candidatePath: string, message: string): string {
  const resolvedCandidate = path.resolve(candidatePath);

  if (!isPathWithin(parentPath, resolvedCandidate)) {
    throw new Error(message);
  }

  return resolvedCandidate;
}
