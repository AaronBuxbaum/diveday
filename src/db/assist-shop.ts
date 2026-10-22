import type { z } from "zod";
import { type AssistOptions, assistsAvailable, type RunAssistInput, runAssist } from "./assists";
import type { AppDb } from "./client";

/**
 * The door the desk and content assists go through: a thin layer over the
 * seam's `runAssist` (and so its cap reservation, in-flight limit and usage
 * row) and `assistsAvailable`. The browser fleet's canned provider is chosen
 * inside the seam itself, so every layer's assists light for an armed shop.
 */
export function shopAssist<S extends z.ZodType>(
  db: AppDb,
  input: RunAssistInput<S>,
): Promise<z.infer<S> | null> {
  return runAssist(db, input);
}

export function shopAssistsAvailable(
  db: AppDb,
  shopId: string,
  options: AssistOptions = {},
): Promise<boolean> {
  // An assist is never the reason a page fails: a read that throws (a
  // database blip, a missing row) reads as dark, and the page renders the way
  // it always did.
  return assistsAvailable(db, shopId, options).catch(() => false);
}
