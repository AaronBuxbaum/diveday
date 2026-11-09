import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inputsFingerprint } from "./db-template-inputs";
import {
  CACHE_DIR,
  manifestFile,
  readManifest,
  readSnapshot,
  refreshTemplateReader,
  type TemplateManifest,
  VARIANTS,
} from "./db-template-read";

export { type TemplateVariant, templateBytes } from "./db-template-read";

/** Build (or reuse) the migrated (and, for two of three, demo-seeded) snapshots. Once per run. */
export type TemplateTiming = {
  phase: "fingerprint" | "cache" | "build";
  durationMs: number;
  cacheHit?: boolean;
  variant?: string;
};

export async function ensureTestDbTemplate(
  options: { onTiming?: (timing: TemplateTiming) => void } = {},
): Promise<string> {
  const started = performance.now();
  const fingerprint = await inputsFingerprint();
  options.onTiming?.({ phase: "fingerprint", durationMs: performance.now() - started });
  const cacheStarted = performance.now();
  const meta = await readManifest(fingerprint);
  const cached =
    meta !== null &&
    (await Promise.all(VARIANTS.map((variant) => readSnapshot(meta.files[variant])))).every(
      Boolean,
    );
  options.onTiming?.({
    phase: "cache",
    durationMs: performance.now() - cacheStarted,
    cacheHit: cached,
  });
  if (cached) {
    refreshTemplateReader(fingerprint);
    return fingerprint;
  }

  // A warm cache needs filesystem reads only; loading the seed graph costs seconds.
  const { buildSnapshot } = await import("./db-template-build");
  await mkdir(CACHE_DIR, { recursive: true });
  const files = {} as TemplateManifest["files"];
  for (const variant of VARIANTS) {
    const buildStarted = performance.now();
    const bytes = await buildSnapshot(variant);
    if (bytes.length === 0) throw new Error(`Empty database snapshot: ${variant}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const file = `${sha256}.tar`;
    const destination = path.join(CACHE_DIR, file);
    const staging = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(staging, bytes);
      await rename(staging, destination);
    } finally {
      await rm(staging, { force: true });
    }
    files[variant] = { file, size: bytes.length, sha256 };
    options.onTiming?.({
      phase: "build",
      variant,
      durationMs: performance.now() - buildStarted,
      cacheHit: false,
    });
  }
  // One atomic publication covers the entire immutable generation. Interrupted
  // writers leave only unreachable blobs, never a mixed or partial generation.
  const destination = manifestFile(fingerprint);
  const staging = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(staging, JSON.stringify({ fingerprint, files }));
    await rename(staging, destination);
  } finally {
    await rm(staging, { force: true });
  }
  refreshTemplateReader(fingerprint);
  return fingerprint;
}
