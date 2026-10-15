import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { noticeCode } from "@/lib/staff-notices";

/**
 * **A refusal that lands here has to say something.**
 *
 * Two of them did not. `sendRecapAction` answers a failed send with `invalid`,
 * `keepRentalFitAction` answers an unprovable reservation with `invalid` and a
 * person id outside the shop with `unknown_person`, and neither code had an
 * entry in either of this page's notice maps — so the staffer who tapped got a
 * reload and silence, which is the one outcome a refusal may never have
 * (`src/lib/staff-notices.ts` names the same failure in its own header).
 *
 * The fit-keep's half is a compile error now: `EVENING_NOTICES` is typed
 * against `ConfirmRentalFitOutcome`. This covers what no type can see — the
 * codes `actions.ts` writes into the URL as literals, and whether the keys
 * those map to are words in both locales rather than a dotted path on screen.
 *
 * It reads the two files' source because the page is a server component whose
 * maps are local to it: there is no render to inspect without a database, a
 * session and a shop. Same shape as `src/app/waivers/[token]/page.composition.test.ts`,
 * for the same reason.
 */

const PAGE = readFileSync(join(__dirname, "page.tsx"), "utf8");
const ACTIONS = readFileSync(join(__dirname, "actions.ts"), "utf8");

const LOCALES = ["en-US", "es-ES"] as const;

/** Every code `actions.ts` hands `noticeUrl` as a literal on the way back here. */
function emittedLiteralCodes(): string[] {
  const codes = new Set<string>();
  for (const [, code] of ACTIONS.matchAll(/noticeUrl\(\s*home,\s*"([a-z0-9_-]+)"/g)) {
    codes.add(noticeCode(code));
  }
  return [...codes].sort();
}

/**
 * The codes an action picks at run time rather than writing as a literal, so
 * the sweep above cannot see them: the recap send's two outcomes, the two the
 * crew-photo upload chooses between, and the fit-keep's own refusals, which are
 * `confirmRentalFitSize`'s union handed straight to `noticeUrl(home, result)`.
 * Spelled out because a ternary arm and a type are both invisible to a grep —
 * and the last two are the codes that were silent.
 */
const CHOSEN_AT_RUNTIME = [
  "recap-sent",
  "recap-send-attention",
  "crew-photo-limit",
  "crew-photo-unconfigured",
  "invalid",
  "unknown-person",
] as const;

/** The `StaffMessageKey` this page's maps give a code, from either map. */
function messageKeyFor(code: string): string | undefined {
  const entry = new RegExp(`(?:"${code}"|${code})\\s*:\\s*(?:\\{[^}]*key:\\s*)?"([\\w.]+)"`).exec(
    PAGE,
  );
  return entry?.[1];
}

describe("the shop home's notice maps", () => {
  it("sweeps the codes its own actions emit, so this test cannot go quiet", () => {
    // A guard whose input can empty out proves nothing. These three are the
    // shape the sweep looks for; the assertions below are what it is for.
    expect(emittedLiteralCodes()).toEqual(
      expect.arrayContaining(["invalid", "recap-locked", "crew-photo-added"]),
    );
  });

  it("answers every code an action redirects here with", () => {
    for (const code of [...emittedLiteralCodes(), ...CHOSEN_AT_RUNTIME]) {
      expect(messageKeyFor(code), `no notice entry for ?notice=${code}`).toBeTruthy();
    }
  });

  it.each(LOCALES)("gives each of those codes words in %s", (locale) => {
    const t = staffTranslator(locale);
    for (const code of [...emittedLiteralCodes(), ...CHOSEN_AT_RUNTIME]) {
      const key = messageKeyFor(code);
      if (!key) throw new Error(`no notice entry for ?notice=${code}`);
      // A missing key translates to the key itself, which renders a dotted
      // path where a sentence belongs.
      expect(t(key as Parameters<typeof t>[0]), `${key} is untranslated in ${locale}`).not.toBe(
        key,
      );
    }
  });
});
