import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Conservatively include the non-test source graph: seed helpers reach lib, i18n,
// features and configuration. Keep the outer CI key in sync with this manifest.
export const TEMPLATE_INPUT_ROOTS = ["drizzle", "src", "config"] as const;
export const TEMPLATE_INPUT_EXCLUDES = ["!**/*.test.*", "!**/*.spec.*", "!**/*.snap"] as const;
export const TEMPLATE_INPUT_FILES = ["pnpm-lock.yaml", "package.json"] as const;

export async function inputsFingerprint(root = process.cwd()): Promise<string> {
  const hash = createHash("sha256");
  const files: string[] = [...TEMPLATE_INPUT_FILES];
  for (const directory of TEMPLATE_INPUT_ROOTS) {
    const entries = await readdir(path.join(root, directory), {
      recursive: true,
      withFileTypes: true,
    });
    files.push(
      ...entries
        .filter((entry) => entry.isFile() && !/(?:\.test\.|\.spec\.|\.snap$)/.test(entry.name))
        .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name))),
    );
  }
  for (const file of files.sort()) {
    const bytes = await readFile(path.join(root, file));
    hash.update(`${file}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}
