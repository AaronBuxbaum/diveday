import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";

/**
 * **search**: "the German couple from March who dove nitrox" becomes the
 * divers list's own filters. It only ever sets the three things the list
 * already shows and lets a staffer change (the search box, the view chip and
 * the order), so the answer is a URL the staffer could have built by hand.
 * Anything the list cannot filter on is left out, never approximated.
 */

export const DIVER_SEARCH_FEATURE = "diver_search";

/** A plain-words ask, as typed. */
export const DIVER_SEARCH_MAX_ASK = 200;
/** The search box's own reach: a name, an email or a phone fragment. */
const MAX_QUERY = 80;

export const DIVER_SEARCH_SYSTEM = [
  "A dive shop staffer describes, in plain words, which divers they want to see in the shop's list of divers.",
  "Turn it into the list's own controls and nothing else:",
  "- query: text the search box matches against a diver's name, email or phone. Only a name, an email or a phone fragment the staffer actually typed. Otherwise null.",
  "- view: one of the offered views, when the ask clearly means it. Otherwise all.",
  "- sort: last_dived when the ask is about recency of diving, otherwise name.",
  "Ignore anything the list cannot filter on, such as nationality, month or gas mix. Never invent a name.",
].join("\n");

export function diverSearchCall<View extends string>(
  ask: string,
  views: readonly [View, ...View[]],
) {
  const schema = z.object({
    query: z.string().nullable(),
    view: z.enum(views),
    sort: z.enum(["name", "last_dived"]),
  });
  const call: StructuredCall<typeof schema> = {
    model: "quick",
    system: DIVER_SEARCH_SYSTEM,
    content: `Views: ${views.join(", ")}.\nAsk: ${ask}`,
    schema,
    maxTokens: 400,
  };
  return call;
}

/** The filters to apply, with a query only when it is one the box would take. */
export function diverSearchFilters<View extends string>(
  value: { query: string | null; view: View; sort: "name" | "last_dived" } | null,
  ask: string,
): { query: string; view: View; sort: "name" | "last_dived" } | null {
  if (!value) return null;
  const query = value.query?.trim() ?? "";
  // The query must be words the staffer typed: a name the model made up would
  // narrow the list to nobody and look like a finding.
  const typed =
    query && ask.toLowerCase().includes(query.toLowerCase()) && query.length <= MAX_QUERY;
  return { query: typed ? query : "", view: value.view, sort: value.sort };
}

export function diverSearchFixture(): unknown {
  return { query: null, view: "not_back", sort: "last_dived" };
}
