import type { z } from "zod";
import { e2eClaudeFixtureProvider } from "@/lib/assists/e2e-fixtures";
import { type AssistOptions, assistsAvailable, type RunAssistInput, runAssist } from "./assists";
import type { AppDb } from "./client";

/**
 * The one door the desk and content assists go through: `runAssist` and
 * `assistsAvailable` from the seam, with the browser fleet's canned provider
 * for a shop a spec armed (`src/lib/assists/e2e-fixtures.ts`). Everywhere else
 * the provider is the seam's own, and everything the seam decides (dark, the
 * cap, the usage row) is decided there.
 */
function withFixture<T extends AssistOptions>(shopId: string, options: T): T {
  if (options.provider) return options;
  const provider = e2eClaudeFixtureProvider(shopId);
  return provider ? { ...options, provider } : options;
}

export function shopAssist<S extends z.ZodType>(
  db: AppDb,
  input: RunAssistInput<S>,
): Promise<z.infer<S> | null> {
  return runAssist(db, withFixture(input.shopId, input));
}

export function shopAssistsAvailable(
  db: AppDb,
  shopId: string,
  options: AssistOptions = {},
): Promise<boolean> {
  // An assist is never the reason a page fails: a read that throws (a
  // database blip, a missing row) reads as dark, and the page renders the way
  // it always did.
  return assistsAvailable(db, shopId, withFixture(shopId, options)).catch(() => false);
}
