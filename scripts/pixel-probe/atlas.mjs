import fs from "node:fs";
import path from "node:path";

/** Each capture run owns its images, so a retained signature cannot hide changed pixels. */
export function atlasRunDirectory(root, runId) {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("Invalid atlas run id");
  return path.join(root, "runs", runId);
}

/** Claim one signature for a worker across all states, including across parallel workers. */
export function claimAtlasSignature(root, runId, hash, seen) {
  if (!/^[a-zA-Z0-9-]+$/.test(hash)) throw new Error("Invalid atlas signature");
  const key = `owner:${runId}:${hash}`;
  if (seen.has(key)) return true;
  const dir = atlasRunDirectory(root, runId);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const fd = fs.openSync(path.join(dir, `.claim-${hash}`), "wx");
    fs.closeSync(fd);
    seen.add(key);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

/** Run ids begin with their creation timestamp, so lexical order selects the latest run. */
export function latestAtlasRunDirectory(root) {
  const runs = path.join(root, "runs");
  if (!fs.existsSync(runs)) return null;
  const latest = fs
    .readdirSync(runs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  return latest ? atlasRunDirectory(root, latest) : null;
}
