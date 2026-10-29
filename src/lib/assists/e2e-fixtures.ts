import type { ClaudeMessage, ClaudeProvider, ClaudeRequest } from "@/lib/claude/provider";
import { BENCH_NOTE_SYSTEM, benchNoteFixture } from "./bench-note";
import { CERT_SCAN_SYSTEM, certScanFixture } from "./cert-scan";
import { DESCRIPTION_DRAFT_SYSTEM, descriptionDraftFixture } from "./description-draft";
import { FRONT_FIXTURES } from "./front-fixtures";
import { MONDAY_READ_SYSTEM, mondayReadFixture } from "./monday-read";
import { RECAP_LINE_SYSTEM, recapLineFixture } from "./recap-line";
import { RENTAL_NOTE_SYSTEM, rentalNoteFixture } from "./rental-note";
import { REVIEW_FLAGS_SYSTEM, reviewFlagsFixture } from "./review-flags";
import { REVIEW_THEMES_SYSTEM, reviewThemesFixture } from "./review-themes";
import { SAME_PERSON_SYSTEM, samePersonFixture } from "./same-person";
import { SHOP_TRANSLATE_SYSTEM, shopTranslateFixture } from "./shop-translate";
import { SIGHTINGS_MATCH_SYSTEM, sightingsMatchFixture } from "./sightings-match";
import { SITE_BRIEF_SYSTEM, siteBriefFixture } from "./site-brief";

/**
 * **A canned Claude for the browser fleet**, so an assist's surface can be
 * photographed. The fleet runs with `DIVEDAY_DISABLE_EXTERNAL_HTTP=1` and no
 * key, so every assist is dark there by the
 * seam's own rules. A spec arms one private shop through
 * `/api/test/claude-fixtures`; for that shop alone the assists answer from the
 * fixtures below, chosen by the feature's fixed instructions.
 *
 * Never in a real deployment: `e2eClaudeFixtureProvider` answers null unless
 * the harness flag is set and no real database is configured, the same
 * predicate `/api/test/*` routes hold (`src/lib/e2e-test-routes.ts`), and the
 * arming route also takes the harness bearer secret.
 */

const FIXTURES: ReadonlyMap<string, (request: ClaudeRequest) => unknown> = new Map<
  string,
  (request: ClaudeRequest) => unknown
>([
  [CERT_SCAN_SYSTEM, certScanFixture],
  [RENTAL_NOTE_SYSTEM, rentalNoteFixture],
  [SAME_PERSON_SYSTEM, samePersonFixture],
  [REVIEW_FLAGS_SYSTEM, reviewFlagsFixture],
  [REVIEW_THEMES_SYSTEM, reviewThemesFixture],
  [MONDAY_READ_SYSTEM, mondayReadFixture],
  [DESCRIPTION_DRAFT_SYSTEM, descriptionDraftFixture],
  [SHOP_TRANSLATE_SYSTEM, shopTranslateFixture],
  [SITE_BRIEF_SYSTEM, siteBriefFixture],
  [RECAP_LINE_SYSTEM, recapLineFixture],
  [SIGHTINGS_MATCH_SYSTEM, sightingsMatchFixture],
  [BENCH_NOTE_SYSTEM, benchNoteFixture],
  ...FRONT_FIXTURES,
]);

function systemText(request: ClaudeRequest): string {
  const system = request.system;
  if (typeof system === "string") return system;
  return system?.[0]?.text ?? "";
}

/** The fixture answer for one request, shaped as the API answers. */
export function fixtureMessage(request: ClaudeRequest): ClaudeMessage {
  const answer = FIXTURES.get(systemText(request))?.(request) ?? {};
  return {
    id: "msg_e2e_fixture",
    type: "message",
    role: "assistant",
    model: request.model,
    content: [{ type: "text", text: JSON.stringify(answer), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as ClaudeMessage;
}

const ARMED_KEY = Symbol.for("diveday.e2eClaudeFixtureShops");

/** One set per server process, whichever bundle layer asks. */
function armedShops(): Set<string> {
  const holder = globalThis as { [ARMED_KEY]?: Set<string> };
  holder[ARMED_KEY] ??= new Set<string>();
  return holder[ARMED_KEY];
}

/** True only inside the browser fleet's own server. */
export function e2eFixturesAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.DIVEDAY_E2E === "1" && !env.DATABASE_URL;
}

export function armClaudeFixtures(shopId: string, armed: boolean): void {
  if (armed) armedShops().add(shopId);
  else armedShops().delete(shopId);
}

/** The fixture provider for an armed shop in the fleet, otherwise null. */
export function e2eClaudeFixtureProvider(
  shopId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ClaudeProvider | null {
  if (!e2eFixturesAllowed(env) || !armedShops().has(shopId)) return null;
  return { createMessage: async (request) => fixtureMessage(request) };
}
