import path from "node:path";

/**
 * Files below one relative directory, in native depth-first listing order.
 * `listDirectory` receives relative paths and returns Dirent-like entries.
 * Directory symlinks are not followed, and a disappearing directory is empty.
 */
export async function filesUnder(relativeDirectory, listDirectory, includeFile = () => true) {
  let entries;
  try {
    entries = await listDirectory(relativeDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(relativePath, listDirectory, includeFile)));
    } else if (includeFile(relativePath, entry)) {
      files.push(relativePath);
    }
  }
  return files;
}
