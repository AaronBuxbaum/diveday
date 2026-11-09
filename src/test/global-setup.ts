import type { TestProject } from "vitest/node";
import { ensureTestDbTemplate } from "./db-template";
import { inputsFingerprint } from "./db-template-inputs";
import { TEST_FROZEN_CLOCK } from "./frozen-clock";

/**
 * Build the shared PGlite template snapshot before any worker starts.
 *
 * This runs in Vitest's own process, which does not inherit vitest.config.ts's
 * `test.env` (that's injected into test workers only) — so the clock-anchored
 * demo seed (src/db/seed.ts) would otherwise build against the live wall
 * clock while every test queries against the frozen one, permanently
 * disagreeing on "today" outside the one real calendar day the frozen instant
 * falls on. Freeze it here too, to the same instant.
 */
export default async function globalSetup(project: TestProject): Promise<void> {
  process.env.DATABASE_URL = "";
  process.env.DATABASE_URL_UNPOOLED = "";
  process.env.DIVEDAY_CLOCK = TEST_FROZEN_CLOCK;
  process.env.TZ = "UTC";
  const publish = async () => {
    project.provide("divedayTemplateGeneration", await ensureTestDbTemplate());
  };
  await publish();
  // The coordinator's seed imports can remain cached across watch edits. Never
  // rebuild under a new identity using those old exports. Fresh workers validate
  // an existing matching snapshot or seed from their freshly loaded modules.
  // Vitest awaits this before spawning rerun workers and serializing context.
  project.onTestsRerun(async () => {
    project.provide("divedayTemplateGeneration", await inputsFingerprint());
  });
}
