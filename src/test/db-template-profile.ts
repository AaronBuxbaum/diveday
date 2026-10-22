// Explicit diagnostic command; ordinary test runs neither write nor print profiling data.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { closePglite } from "@/db/close-pglite";
import { ensureTestDbTemplate, type TemplateTiming } from "./db-template";
import { templateBytes, VARIANTS } from "./db-template-read";
import { TEST_FROZEN_CLOCK } from "./frozen-clock";

export async function measurePhase<T>(run: () => Promise<T>, clock = () => performance.now()) {
  const start = clock();
  const value = await run();
  return { value, durationMs: clock() - start };
}

async function main() {
  // Identical isolation and clock inputs to global-setup; never a production database.
  process.env.DATABASE_URL = "";
  process.env.DATABASE_URL_UNPOOLED = "";
  process.env.DIVEDAY_CLOCK = TEST_FROZEN_CLOCK;
  process.env.TZ = "UTC";
  const timings: TemplateTiming[] = [];
  await ensureTestDbTemplate({ onTiming: (timing) => timings.push(timing) });
  const hydrations = [];
  for (const variant of VARIANTS) {
    const read = await measurePhase(() => templateBytes(variant));
    if (!read.value) throw new Error(`No usable ${variant} snapshot after template setup`);
    const bytes = read.value;
    const hydration = await measurePhase(async () => {
      const client = new PGlite({
        loadDataDir: new Blob([bytes]),
        extensions: { pg_trgm, btree_gist },
      });
      try {
        await client.waitReady;
        return client;
      } catch (error) {
        await closePglite(client);
        throw error;
      }
    });
    await closePglite(hydration.value);
    hydrations.push({
      variant,
      readMs: read.durationMs,
      hydrationMs: hydration.durationMs,
      bytes: bytes.byteLength,
    });
  }
  const output = process.argv[2] ?? ".agent-out/fixture-profile.json";
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ version: 1, timings, hydrations, limitations: "One local observation. No rows, credentials or environment values recorded; fingerprint remains conservative." }, null, 2)}\n`,
  );
  console.log(`Fixture measurements: ${output}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
