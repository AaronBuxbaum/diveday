import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Explicit maintenance only: the caller must have stopped all cache readers and writers. */
export async function cleanTemplateCache(
  directory: string,
  options: { idle: boolean; keep: number },
) {
  if (!options.idle)
    throw new Error("Stop every test/watch invocation sharing this cache, then pass --idle.");
  if (!Number.isInteger(options.keep) || options.keep < 1 || options.keep > 20) {
    throw new Error("Retain count must be an integer from 1 to 20.");
  }
  const names = await readdir(directory);
  const manifests = await Promise.all(
    names
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map(async (name) => {
        const file = path.join(directory, name);
        const manifest = JSON.parse(await readFile(file, "utf8")) as {
          files?: Record<string, { file?: string }>;
        };
        const blobs = ["lean", "history", "empty"].map(
          (variant) => manifest.files?.[variant]?.file,
        );
        if (blobs.some((blob) => !blob || !/^[a-f0-9]{64}\.tar$/.test(blob))) {
          throw new Error(`Refusing cleanup of an unreadable generation: ${name}`);
        }
        return { name, blobs: blobs as string[], modified: (await stat(file)).mtimeMs };
      }),
  );
  manifests.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  const live = new Set(manifests.slice(0, options.keep).flatMap((manifest) => manifest.blobs));
  const remove = [
    ...manifests.slice(options.keep).map((manifest) => manifest.name),
    ...names.filter((name) => /^[a-f0-9]{64}\.tar$/.test(name) && !live.has(name)),
    ...names.filter((name) => /^[a-f0-9]{64}\.(?:tar|json)\.[a-f0-9-]+\.tmp$/.test(name)),
  ];
  for (const name of remove) await rm(path.join(directory, name));
  return { retained: Math.min(options.keep, manifests.length), removed: remove.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const keepFlag = args.find((arg) => arg.startsWith("--keep="));
  const directory =
    process.env.DIVEDAY_TEST_CACHE_DIR ?? path.join(process.cwd(), "node_modules/.cache/diveday");
  const result = await cleanTemplateCache(directory, {
    idle: args.includes("--idle"),
    keep: keepFlag ? Number(keepFlag.slice("--keep=".length)) : 3,
  });
  console.log(
    `Test database cache: retained ${result.retained} generations; removed ${result.removed} files.`,
  );
}
