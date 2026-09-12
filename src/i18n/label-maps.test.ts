import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MediaDeletionKind, PaymentOperationKind } from "@/db/schema";
import type { CertificationCardRowState } from "@/lib/certification-cards";
import type { DepthUnit } from "@/lib/depth-units";
import { DIVE_INTENTS } from "@/lib/dive-intent";
import type { RentalItemKind } from "@/lib/dive-prep";
import { DIVE_SITE_DIFFICULTIES } from "@/lib/dive-site-difficulty";
import {
  GEAR_ITEM_STATUSES,
  type GearItemKind,
  type GearReservationPhase,
  type GearServiceKind,
} from "@/lib/gear";
import { GUARDIAN_RELATIONSHIPS } from "@/lib/guardian";
import type { BuddyAlert, RollCallLabel } from "@/lib/manifests";
import { CARDINAL_DIRECTIONS, SEA_STATES, WIND_STATES } from "@/lib/marine-forecast";
import { PLAN_CHANGE_REASONS } from "@/lib/plan-change";
import {
  BLOCKER_CATEGORY,
  type ReadinessBlockerCode,
  type ReadinessBlockerParams,
} from "@/lib/readiness";
import { REMINDER_ACTION_CODES } from "@/lib/readiness-summary";
import { MOON_PHASES, type NightSky } from "@/lib/sky";
import type { TemperatureUnit } from "@/lib/temperature-units";
import { ROLL_CALL_GAP_KINDS, type TodaySeason } from "@/lib/today";
import { buddyAlertText } from "./buddy-labels";
import {
  CARD_STATUS_KEYS,
  CERTIFICATION_ROW_STATE_BADGE,
  HELD_CARD_STATUS_KEYS,
} from "./card-labels";
import {
  CLOSEOUT_ADMIN_STATUS_KEYS,
  CLOSEOUT_DECISION_KEYS,
  CLOSEOUT_STATUS_KEYS,
  closeoutDepartureDetailText,
  planChangeText,
} from "./closeout-labels";
import { compassText } from "./compass-labels";
import {
  DIVER_DIVE_INTENT_KEYS,
  DIVER_RE_ENTRY_KEYS,
  STAFF_RE_ENTRY_KEYS,
  staffDiveIntentLine,
} from "./dive-intent-labels";
import { diveSiteDifficultyLabel } from "./dive-site-labels";
import { DIVER_FACT_SOURCE_KEYS } from "./fact-source-labels";
import {
  gearItemKindLabel,
  gearPhaseLabel,
  gearServiceKindLabel,
  gearStatusLabel,
} from "./gear-labels";
import {
  DIVER_GUARDIAN_RELATIONSHIP_KEYS,
  guardianRelationshipText,
  staffGuardianRelationshipOptions,
} from "./guardian-labels";
import { rollCallLabelText } from "./manifest-labels";
import { diverTranslator } from "./messages";
import {
  DIVER_CERT_LEVEL_KEYS,
  NEXT_DIVE_REASON_KEYS,
  RECAP_PULSE_CATEGORY_KEYS,
  STAFF_PULSE_CATEGORY_KEYS,
} from "./next-dive-labels";
import { ORDER_STATUS_KEYS } from "./order-labels";
import {
  CERTIFICATION_LEVEL_KEYS,
  DIVER_CERTIFICATION_AGENCY_KEYS,
  DIVER_CERTIFICATION_LEVEL_KEYS,
  DIVER_DIVE_RECENCY_KEYS,
  DIVER_SPECIALTY_KEYS,
  READINESS_STATUS_KEYS,
  readinessBlockerText,
  readinessStatusText,
  SPECIALTY_KEYS,
  STAFF_DIVE_RECENCY_KEYS,
} from "./readiness-labels";
import { CHECKLIST_DETAIL_KEYS } from "./readiness-summary-labels";
import { reminderActionText } from "./reminder-labels";
import { rentalItemLabel } from "./rental-labels";
import { DEFAULT_DIVER_LOCALE, DIVER_LOCALES, type DiverLocale } from "./settings";
import { nightSkyLine } from "./sky-labels";
import { staffTranslator } from "./staff-messages";
import { THREAD_STEP_STATE_KEYS, THREAD_STEP_TITLE_KEYS } from "./thread-labels";
import {
  ACTION_KIND_KEYS,
  blockerActionLabelText,
  GREETING_KEYS,
  mediaDeletionKindText,
  seasonalBriefingText,
  stuckOperationKindText,
} from "./today-labels";
import { depthText, seaStateText, temperatureText, windText } from "./unit-labels";
import { type WaiverRowState, waiverRowStateText } from "./waiver-labels";

/**
 * **Every code-to-message-key map in this directory, rendered** (issue #1701).
 *
 * A `Record<Code, StaffMessageKey>` proves two things and stops: that every
 * code is mapped, and that the key's *name* is a member of the bundle's key
 * union. It does not prove that the key a code is mapped **to** resolves to a
 * sentence, and `pnpm check:locale` deliberately does not either — its own doc
 * comment scopes it to "what is extracted is translated", which is a
 * comparison of two JSON files and renders nothing. So the gap is invisible
 * from both ends, and `readiness-labels.ts` — the module AGENTS.md names as the
 * pattern every other one copies — sat inside it.
 *
 * ## What this actually catches, and what was already covered
 *
 * Less than "no proof at all" suggests, and saying so is the point of writing
 * it down rather than discovering it later. `DiverMessageKey` is
 * `Parameters<DiverTranslator>[0]`, typed against the **English** bundle, so a
 * mapped key always exists in en-US; `check:locale` then holds es-ES to the
 * same keys with the same ICU placeholders; `icu-messages.test.ts` compiles
 * every message in every bundle. Three things are left over, and all three end
 * up on a screen:
 *
 * 1. **A key whose message interpolates, reached by a resolver that fills
 *    nothing.** `translatorOnError` rethrows outside production
 *    (`src/i18n/on-error.ts`), so rendering every code here is what turns that
 *    into a failing test rather than a brace on a manifest in production. This
 *    is the assertion that carries the file: dropping the `{specialty}` params
 *    for one readiness blocker fails three of its cases with the ICU error.
 * 2. **English sitting in the es-ES bundle.** A missing es-ES key falls back to
 *    the *English* string rather than throwing, so "not empty" is satisfied by
 *    a bundle with no translation in it. Only comparing the two locales sees it.
 * 3. **A private map nobody has a door to.** Twenty-eight of the maps below are
 *    not exported; they are reached here through the resolver the app calls,
 *    which is also the only way the interpolation those resolvers do gets
 *    exercised. Exporting one to reach it would change a module's public
 *    surface to suit a test, so none of them is exported.
 *
 * ## Every map, not most of them
 *
 * The table began at thirty-four of the directory's fifty-eight maps, with
 * seven modules deferred to their own test files in a `PROVED_BY_MODULE_TEST`
 * list. That was the weaker claim of the two and said so: `gear-labels.ts`
 * carries four maps and `gear-labels.test.ts` exercised one of them, so
 * `STATUS_KEYS`, `SERVICE_KIND_KEYS` and `PHASE_KEYS` had no proof that the key
 * each code maps to resolves at all. The list is gone (issue #1756) and every
 * map in the directory has a row; the scan at the bottom now has no allowlist
 * to fall through, and it holds the table to the map count as well as to the
 * names, so a row left behind by a deleted map fails too.
 *
 * The two maps that made it real work were `today-labels.ts`'s
 * `STUCK_OPERATION_KIND_KEYS` and `MEDIA_DELETION_KIND_KEYS`, keyed by `string`
 * rather than a union, so "every code" had no compiler answer and the keys of
 * the literal would only ever have proved the rows somebody already wrote.
 * Both had a closed source of truth sitting unused — the `payment_operation_kind`
 * and `media_deletion_kind` pg enums — so they are keyed on those now, and the
 * second one turned out to hold seven of nine reachable kinds: a stuck
 * `shop_logo` or `shop_hero` deletion put the raw enum value on the Today queue.
 *
 * The failure the issue opens with — a code mapped to the **wrong real key** —
 * is caught by none of that on its own: a wrong-but-real key renders a
 * perfectly good sentence. What narrows it is that a compound code never
 * renders as itself, plus the fact that the table is a reviewable list of
 * every map in the directory — which is the form a reviewer can check a
 * mapping against and a guard cannot.
 *
 * ## Why a test file and not a guard beside `scripts/check-locale.mjs`
 *
 * That script reads JSON with `readFile` and never imports TypeScript or runs
 * ICU, so a guard beside it would have to regex TS source for map literals and
 * still could not format a message — i.e. it could not make assertion 1 at all.
 * The half a guard *is* good at — noticing a map nobody thought to cover — is
 * kept as the textual scan at the bottom of this file, which is cheap enough to
 * live beside the thing it guards.
 *
 * Plural output is `count-agreement.test.ts`'s job and is not restated here;
 * the counted sentences below are rendered at one representative count.
 */

/** Everything one map's rows need to say, with the map's own code type erased. */
type LabelMapCase = {
  /** The file it lives in, spelled as the scan at the bottom names it. */
  module: string;
  /** The map's identifier, likewise. */
  map: string;
  rows: readonly LabelRow[];
};

type LabelRow = {
  code: string;
  /** True for a code whose label is deliberately nothing at all. */
  silent: boolean;
  /** The finished string a surface renders for this code, in one locale. */
  render: (locale: DiverLocale) => string | null;
};

/**
 * One row per code, closing over the code so the table can hold maps keyed by
 * different unions without a cast.
 */
function codeRows<Code extends string>(
  codes: readonly Code[],
  render: (locale: DiverLocale, code: Code) => string | null,
  silent: readonly Code[] = [],
): readonly LabelRow[] {
  return codes.map((code) => ({
    code,
    silent: silent.includes(code),
    render: (locale: DiverLocale) => render(locale, code),
  }));
}

/**
 * The codes of a union with no runtime list of its own. Spelled as a
 * `Record<Code, true>` rather than an array so a member added to the union is a
 * type error here, not a row that silently goes unproven.
 */
function everyCodeOf<Code extends string>(present: Record<Code, true>): readonly Code[] {
  return Object.keys(present) as Code[];
}

const BUDDY_ALERTS = everyCodeOf<BuddyAlert>({
  separated_dock: true,
  separated_after_dive: true,
});

const WAIVER_ROW_STATES = everyCodeOf<WaiverRowState>({
  none: true,
  current: true,
  expired: true,
  guardian_missing: true,
  medical_review: true,
  medical_not_cleared: true,
  failed: true,
});

const ROLL_CALL_LABELS = everyCodeOf<RollCallLabel>({
  awaiting: true,
  boarded: true,
  not_boarded: true,
  not_boarded_carried: true,
  not_back_aboard: true,
});

/**
 * The register's kinds. `GEAR_KIND_ORDER` is a display order typed
 * `readonly GearItemKind[]`, which the compiler cannot hold exhaustive — a
 * kind added to the union and forgotten there would drop out of this table
 * silently, so the codes are spelled here instead.
 */
const GEAR_ITEM_KINDS = everyCodeOf<GearItemKind>({
  bcd: true,
  regulator: true,
  wetsuit: true,
  boots: true,
  mask: true,
  fins: true,
  weights: true,
  dive_computer: true,
  gopro: true,
  tank: true,
  drysuit: true,
  hood: true,
  gloves: true,
  torch: true,
  dpv: true,
  smb: true,
  reel: true,
  camera: true,
  nitrox_analyzer: true,
  o2_kit: true,
  other: true,
});

const GEAR_SERVICE_KINDS = everyCodeOf<GearServiceKind>({
  service: true,
  hydro_test: true,
  visual_inspection: true,
  o2_clean: true,
  note: true,
});

const GEAR_RESERVATION_PHASES = everyCodeOf<GearReservationPhase>({
  reserved: true,
  out: true,
  due_back_today: true,
  overdue: true,
  never_picked_up: true,
  returned: true,
});

const RENTAL_ITEM_KINDS = everyCodeOf<RentalItemKind>({
  bcd: true,
  regulator: true,
  wetsuit: true,
  boots: true,
  mask_fins: true,
  weights: true,
  dive_computer: true,
  gopro: true,
  drysuit: true,
  hood_gloves: true,
  torch: true,
  smb: true,
});

const DEPTH_UNITS = everyCodeOf<DepthUnit>({ meters: true, feet: true });

const TEMPERATURE_UNITS = everyCodeOf<TemperatureUnit>({ celsius: true, fahrenheit: true });

const TODAY_SEASONS = everyCodeOf<TodaySeason>({
  summer: true,
  autumn: true,
  winter: true,
  spring: true,
});

/**
 * **The two maps that were keyed by `string`, now keyed by their enum.** The
 * issue that folded these rows in (#1756) called deciding their codes the one
 * judgement call, because `Record<string, StaffMessageKey>` has no codes a
 * compiler can name and the keys of the literal only ever prove the rows
 * somebody already wrote. Both had a closed source of truth already — the
 * `payment_operation_kind` and `media_deletion_kind` pg enums — so the answer
 * was to key the maps on those rather than to assert the weaker thing here.
 * `media_deletion_kind` carries nine members against the map's seven, and both
 * missing kinds were reachable, which is what the weaker assertion would have
 * missed.
 */
const PAYMENT_OPERATION_KINDS = everyCodeOf<PaymentOperationKind>({
  checkout_session: true,
  invoice: true,
  refund: true,
});

const MEDIA_DELETION_KINDS = everyCodeOf<MediaDeletionKind>({
  course_photo: true,
  recap_photo: true,
  certification_card: true,
  waiver_document: true,
  dive_site_photo: true,
  shop_logo: true,
  shop_hero: true,
  arrival_photo: true,
  payment_receipt: true,
});

/**
 * The params the readiness engine attaches to the five blockers whose sentence
 * interpolates. A code that grows a placeholder and no params throws here
 * rather than printing a brace on a roster row — which is assertion 1 above,
 * and the reason this table plumbs the real resolver instead of the map.
 */
const BLOCKER_PARAMS: Partial<Record<ReadinessBlockerCode, ReadinessBlockerParams>> = {
  certification_insufficient: { requiredLevel: "advanced_open_water" },
  specialty_missing: { specialty: "wreck" },
  specialty_pending: { specialty: "wreck" },
  specialty_import_unconfirmed: { specialty: "wreck" },
  under_minimum_age: { age: 14, minimumAge: 15 },
};

/** Every fact a next-dive reason sentence can name, so one object covers all five. */
const NEXT_DIVE_FACTS = { site: "Blue Hole", course: "Advanced Open Water", lens: "drift" };

/** A sky with a moon up and setting inside the window, so the phase is named. */
const MOONLIT_SKY: Omit<NightSky, "phase"> = {
  sunsetAt: new Date("2026-06-01T23:42:00Z"),
  civilDuskAt: new Date("2026-06-02T00:09:00Z"),
  illuminatedPercent: 62,
  moonOverDive: "sets",
  moonriseAt: null,
  moonsetAt: new Date("2026-06-02T03:15:00Z"),
};

const CASES: readonly LabelMapCase[] = [
  {
    module: "buddy-labels.ts",
    map: "BUDDY_ALERT_KEYS",
    rows: codeRows(BUDDY_ALERTS, (locale, alert) => buddyAlertText(staffTranslator(locale), alert)),
  },
  {
    module: "card-labels.ts",
    map: "CARD_STATUS_KEYS",
    rows: codeRows(keysOf(CARD_STATUS_KEYS), (locale, status) =>
      staffTranslator(locale)(CARD_STATUS_KEYS[status]),
    ),
  },
  {
    module: "card-labels.ts",
    map: "HELD_CARD_STATUS_KEYS",
    rows: codeRows(keysOf(HELD_CARD_STATUS_KEYS), (locale, status) =>
      staffTranslator(locale)(HELD_CARD_STATUS_KEYS[status]),
    ),
  },
  {
    module: "card-labels.ts",
    map: "CERTIFICATION_ROW_STATE_BADGE",
    // `verified` is the design's silence — a green pill down every row of the
    // file is noise pretending to be information — so it is pinned as null
    // here rather than skipped.
    rows: codeRows(
      keysOf(CERTIFICATION_ROW_STATE_BADGE),
      (locale, state) => {
        const badge = CERTIFICATION_ROW_STATE_BADGE[state];
        return badge ? staffTranslator(locale)(badge.key) : null;
      },
      ["verified"] satisfies readonly CertificationCardRowState[],
    ),
  },
  {
    module: "closeout-labels.ts",
    map: "CLOSEOUT_STATUS_KEYS",
    rows: codeRows(keysOf(CLOSEOUT_STATUS_KEYS), (locale, status) =>
      staffTranslator(locale)(CLOSEOUT_STATUS_KEYS[status]),
    ),
  },
  {
    module: "closeout-labels.ts",
    map: "CLOSEOUT_ADMIN_STATUS_KEYS",
    rows: codeRows(keysOf(CLOSEOUT_ADMIN_STATUS_KEYS), (locale, status) =>
      staffTranslator(locale)(CLOSEOUT_ADMIN_STATUS_KEYS[status]),
    ),
  },
  {
    module: "closeout-labels.ts",
    map: "GAP_DETAIL_KEYS",
    // Private, and every one of its six sentences interpolates both a count
    // and a dive number — the case a bundle comparison cannot see at all.
    rows: codeRows(keysOf(ROLL_CALL_GAP_KINDS), (locale, gapReason) =>
      closeoutDepartureDetailText(
        staffTranslator(locale),
        { status: "unreconciled", gapReason, uncounted: 2, diveNumber: 1 },
        "4:30 PM",
      ),
    ),
  },
  {
    module: "closeout-labels.ts",
    map: "PLAN_CHANGE_REASON_KEYS",
    rows: codeRows(PLAN_CHANGE_REASONS, (locale, reasonCode) =>
      planChangeText(staffTranslator(locale), locale, [
        { diveNumber: 1, siteName: "Blue Hole", reasonCode },
      ]),
    ),
  },
  {
    module: "closeout-labels.ts",
    map: "CLOSEOUT_DECISION_KEYS",
    rows: codeRows(keysOf(CLOSEOUT_DECISION_KEYS), (locale, decision) =>
      staffTranslator(locale)(CLOSEOUT_DECISION_KEYS[decision]),
    ),
  },
  {
    module: "compass-labels.ts",
    map: "COMPASS_KEYS",
    // Private, and the reason the module exists: five of the eight letters are
    // the same in Spanish and three are not (O, SO, NO), so the table's
    // es-ES assertion is the one that would have caught `.toUpperCase()`
    // standing in for a lookup.
    rows: codeRows(CARDINAL_DIRECTIONS, (locale, code) =>
      compassText(staffTranslator(locale), code),
    ),
  },
  {
    module: "dive-intent-labels.ts",
    map: "DIVER_DIVE_INTENT_KEYS",
    rows: codeRows(keysOf(DIVER_DIVE_INTENT_KEYS), (locale, intent) =>
      diverTranslator(locale)(DIVER_DIVE_INTENT_KEYS[intent]),
    ),
  },
  {
    module: "dive-intent-labels.ts",
    map: "DIVER_RE_ENTRY_KEYS",
    rows: codeRows(keysOf(DIVER_RE_ENTRY_KEYS), (locale, ask) =>
      diverTranslator(locale)(DIVER_RE_ENTRY_KEYS[ask]),
    ),
  },
  {
    module: "dive-intent-labels.ts",
    map: "STAFF_RE_ENTRY_KEYS",
    rows: codeRows(keysOf(STAFF_RE_ENTRY_KEYS), (locale, ask) =>
      staffTranslator(locale)(STAFF_RE_ENTRY_KEYS[ask]),
    ),
  },
  {
    module: "dive-intent-labels.ts",
    map: "STAFF_DIVE_INTENT_KEYS",
    rows: codeRows(DIVE_INTENTS, (locale, intent) =>
      staffDiveIntentLine(staffTranslator(locale), [{ intent, count: 2 }], locale),
    ),
  },
  {
    module: "dive-site-labels.ts",
    map: "DIFFICULTY_KEYS",
    rows: codeRows(DIVE_SITE_DIFFICULTIES, (locale, difficulty) =>
      diveSiteDifficultyLabel(difficulty, diverTranslator(locale)),
    ),
  },
  {
    module: "fact-source-labels.ts",
    map: "DIVER_FACT_SOURCE_KEYS",
    rows: codeRows(keysOf(DIVER_FACT_SOURCE_KEYS), (locale, source) =>
      diverTranslator(locale)(DIVER_FACT_SOURCE_KEYS[source]),
    ),
  },
  {
    module: "gear-labels.ts",
    map: "KIND_SOURCES",
    // The one map in the directory whose value is a key *or* a redirection
    // into `rental-labels.ts`, so the resolver is the only honest door.
    rows: codeRows(GEAR_ITEM_KINDS, (locale, kind) =>
      gearItemKindLabel(staffTranslator(locale), kind),
    ),
  },
  {
    module: "gear-labels.ts",
    map: "STATUS_KEYS",
    rows: codeRows(GEAR_ITEM_STATUSES, (locale, status) =>
      gearStatusLabel(staffTranslator(locale), status),
    ),
  },
  {
    module: "gear-labels.ts",
    map: "SERVICE_KIND_KEYS",
    rows: codeRows(GEAR_SERVICE_KINDS, (locale, kind) =>
      gearServiceKindLabel(staffTranslator(locale), kind),
    ),
  },
  {
    module: "gear-labels.ts",
    map: "PHASE_KEYS",
    rows: codeRows(GEAR_RESERVATION_PHASES, (locale, phase) =>
      gearPhaseLabel(staffTranslator(locale), phase),
    ),
  },
  {
    module: "guardian-labels.ts",
    map: "GUARDIAN_RELATIONSHIP_KEYS",
    rows: codeRows(GUARDIAN_RELATIONSHIPS, (locale, relationship) =>
      guardianRelationshipText(staffTranslator(locale), relationship),
    ),
  },
  {
    module: "guardian-labels.ts",
    map: "DIVER_GUARDIAN_RELATIONSHIP_KEYS",
    rows: codeRows(GUARDIAN_RELATIONSHIPS, (locale, relationship) =>
      diverTranslator(locale)(DIVER_GUARDIAN_RELATIONSHIP_KEYS[relationship]),
    ),
  },
  {
    module: "guardian-labels.ts",
    map: "GUARDIAN_RELATIONSHIP_OPTION_KEYS",
    // The `<select>`'s own spelling of the same two codes, private to the
    // module and reachable only through the options builder.
    rows: codeRows(GUARDIAN_RELATIONSHIPS, (locale, relationship) => {
      const options = staffGuardianRelationshipOptions(staffTranslator(locale));
      return options.find((option) => option.value === relationship)?.label ?? null;
    }),
  },
  {
    module: "manifest-labels.ts",
    map: "ROLL_CALL_STATE_KEYS",
    rows: codeRows(ROLL_CALL_LABELS, (locale, label) =>
      rollCallLabelText(staffTranslator(locale), label),
    ),
  },
  {
    module: "next-dive-labels.ts",
    map: "NEXT_DIVE_REASON_KEYS",
    // Four of the five sentences name a fact, and the recap passes all three
    // placeholders on every branch — so one params object covers the map, the
    // same way `next-dive-labels.test.ts` does it.
    rows: codeRows(keysOf(NEXT_DIVE_REASON_KEYS), (locale, reason) =>
      diverTranslator(locale)(NEXT_DIVE_REASON_KEYS[reason], NEXT_DIVE_FACTS),
    ),
  },
  {
    module: "next-dive-labels.ts",
    map: "DIVER_CERT_LEVEL_KEYS",
    rows: codeRows(keysOf(DIVER_CERT_LEVEL_KEYS), (locale, level) =>
      diverTranslator(locale)(DIVER_CERT_LEVEL_KEYS[level]),
    ),
  },
  {
    module: "next-dive-labels.ts",
    map: "RECAP_PULSE_CATEGORY_KEYS",
    rows: codeRows(keysOf(RECAP_PULSE_CATEGORY_KEYS), (locale, category) =>
      diverTranslator(locale)(RECAP_PULSE_CATEGORY_KEYS[category]),
    ),
  },
  {
    module: "next-dive-labels.ts",
    map: "STAFF_PULSE_CATEGORY_KEYS",
    rows: codeRows(keysOf(STAFF_PULSE_CATEGORY_KEYS), (locale, category) =>
      staffTranslator(locale)(STAFF_PULSE_CATEGORY_KEYS[category]),
    ),
  },
  {
    module: "order-labels.ts",
    map: "ORDER_STATUS_KEYS",
    rows: codeRows(keysOf(ORDER_STATUS_KEYS), (locale, status) =>
      staffTranslator(locale)(ORDER_STATUS_KEYS[status]),
    ),
  },
  {
    module: "readiness-labels.ts",
    map: "READINESS_STATUS_KEYS",
    rows: codeRows(keysOf(READINESS_STATUS_KEYS), (locale, status) =>
      readinessStatusText(staffTranslator(locale), status),
    ),
  },
  {
    module: "readiness-labels.ts",
    map: "CERTIFICATION_LEVEL_KEYS",
    rows: codeRows(keysOf(CERTIFICATION_LEVEL_KEYS), (locale, level) =>
      staffTranslator(locale)(CERTIFICATION_LEVEL_KEYS[level]),
    ),
  },
  {
    module: "readiness-labels.ts",
    map: "DIVER_CERTIFICATION_LEVEL_KEYS",
    rows: codeRows(keysOf(DIVER_CERTIFICATION_LEVEL_KEYS), (locale, level) =>
      diverTranslator(locale)(DIVER_CERTIFICATION_LEVEL_KEYS[level]),
    ),
  },
  {
    module: "readiness-labels.ts",
    map: "SPECIALTY_KEYS",
    rows: codeRows(keysOf(SPECIALTY_KEYS), (locale, specialty) =>
      staffTranslator(locale)(SPECIALTY_KEYS[specialty]),
    ),
  },
  {
    module: "readiness-labels.ts",
    map: "DIVER_DIVE_RECENCY_KEYS",
    rows: codeRows(keysOf(DIVER_DIVE_RECENCY_KEYS), (locale, band) =>
      diverTranslator(locale)(DIVER_DIVE_RECENCY_KEYS[band]),
    ),
  },
  {
    module: "readiness-labels.ts",
    map: "STAFF_DIVE_RECENCY_KEYS",
    rows: codeRows(keysOf(STAFF_DIVE_RECENCY_KEYS), (locale, band) =>
      staffTranslator(locale)(STAFF_DIVE_RECENCY_KEYS[band]),
    ),
  },
  {
    module: "readiness-labels.ts",
    map: "DIVER_SPECIALTY_KEYS",
    rows: codeRows(keysOf(DIVER_SPECIALTY_KEYS), (locale, specialty) =>
      diverTranslator(locale)(DIVER_SPECIALTY_KEYS[specialty]),
    ),
  },
  {
    module: "readiness-labels.ts",
    map: "READINESS_BLOCKER_KEYS",
    // Private, twenty-two codes, and the one map in the directory whose
    // resolver translates a *second* code into the placeholder it fills.
    rows: codeRows(keysOf(BLOCKER_CATEGORY), (locale, code) =>
      readinessBlockerText(staffTranslator(locale), { code, params: BLOCKER_PARAMS[code] }),
    ),
  },
  {
    module: "readiness-labels.ts",
    map: "DIVER_CERTIFICATION_AGENCY_KEYS",
    rows: codeRows(keysOf(DIVER_CERTIFICATION_AGENCY_KEYS), (locale, agency) =>
      diverTranslator(locale)(DIVER_CERTIFICATION_AGENCY_KEYS[agency]),
    ),
  },
  {
    module: "readiness-summary-labels.ts",
    map: "CHECKLIST_DETAIL_KEYS",
    rows: codeRows(keysOf(CHECKLIST_DETAIL_KEYS), (locale, detail) =>
      diverTranslator(locale)(CHECKLIST_DETAIL_KEYS[detail]),
    ),
  },
  {
    module: "reminder-labels.ts",
    map: "REMINDER_ACTION_KEYS",
    rows: codeRows(REMINDER_ACTION_CODES, (locale, code) =>
      reminderActionText(diverTranslator(locale), code),
    ),
  },
  {
    module: "rental-labels.ts",
    map: "RENTAL_ITEM_LABEL_KEYS",
    // Keyed by dive-prep's packing alphabet, which is the superset — the
    // register and the shop catalog both index this one map.
    rows: codeRows(RENTAL_ITEM_KINDS, (locale, kind) =>
      rentalItemLabel(staffTranslator(locale), kind),
    ),
  },
  {
    module: "sky-labels.ts",
    map: "MOON_PHASE_KEYS",
    rows: codeRows(MOON_PHASES, (locale, phase) =>
      nightSkyLine(
        diverTranslator(locale),
        { ...MOONLIT_SKY, phase },
        { sunset: "7:42 PM", dusk: "8:09 PM", moonset: "11:15 PM" },
      ),
    ),
  },
  {
    module: "thread-labels.ts",
    map: "THREAD_STEP_TITLE_KEYS",
    rows: codeRows(keysOf(THREAD_STEP_TITLE_KEYS), (locale, step) =>
      diverTranslator(locale)(THREAD_STEP_TITLE_KEYS[step]),
    ),
  },
  {
    module: "thread-labels.ts",
    map: "THREAD_STEP_STATE_KEYS",
    rows: codeRows(keysOf(THREAD_STEP_STATE_KEYS), (locale, state) =>
      diverTranslator(locale)(THREAD_STEP_STATE_KEYS[state]),
    ),
  },
  {
    module: "today-labels.ts",
    map: "ACTION_KIND_KEYS",
    rows: codeRows(keysOf(ACTION_KIND_KEYS), (locale, kind) =>
      staffTranslator(locale)(ACTION_KIND_KEYS[kind]),
    ),
  },
  {
    module: "today-labels.ts",
    map: "BLOCKER_ACTION_LABEL_KEYS",
    // The singular verb on a row that fixes one diver in place.
    rows: codeRows(keysOf(BLOCKER_CATEGORY), (locale, code) =>
      blockerActionLabelText(staffTranslator(locale), code, false),
    ),
  },
  {
    module: "today-labels.ts",
    map: "BLOCKER_GROUP_LABEL_KEYS",
    // The same twenty-two codes in the plural, for a row standing for several
    // divers — one resolver, one boolean apart, so both maps need a row.
    rows: codeRows(keysOf(BLOCKER_CATEGORY), (locale, code) =>
      blockerActionLabelText(staffTranslator(locale), code, true),
    ),
  },
  {
    module: "today-labels.ts",
    map: "STUCK_OPERATION_KIND_KEYS",
    rows: codeRows(PAYMENT_OPERATION_KINDS, (locale, kind) =>
      stuckOperationKindText(staffTranslator(locale), kind),
    ),
  },
  {
    module: "today-labels.ts",
    map: "MEDIA_DELETION_KIND_KEYS",
    rows: codeRows(MEDIA_DELETION_KINDS, (locale, kind) =>
      mediaDeletionKindText(staffTranslator(locale), kind),
    ),
  },
  {
    module: "today-labels.ts",
    map: "GREETING_KEYS",
    rows: codeRows(keysOf(GREETING_KEYS), (locale, band) =>
      staffTranslator(locale)(GREETING_KEYS[band], { name: "Priya" }),
    ),
  },
  {
    module: "today-labels.ts",
    map: "SEASONAL_BRIEFING_KEYS",
    // Private, and every sentence carries a `select` on whether there is a
    // shop to name — rendered with a name, so the branch that interpolates is
    // the one exercised.
    rows: codeRows(TODAY_SEASONS, (locale, season) =>
      seasonalBriefingText(staffTranslator(locale), season, "Blue Mantis Divers"),
    ),
  },
  {
    module: "unit-labels.ts",
    map: "DEPTH_UNIT_KEYS",
    rows: codeRows(DEPTH_UNITS, (locale, unit) => depthText(diverTranslator(locale), 18, unit)),
  },
  {
    module: "unit-labels.ts",
    map: "TEMPERATURE_UNIT_KEYS",
    rows: codeRows(TEMPERATURE_UNITS, (locale, unit) =>
      temperatureText(diverTranslator(locale), 24, unit),
    ),
  },
  {
    module: "unit-labels.ts",
    map: "SEA_STATE_KEYS",
    rows: codeRows(
      SEA_STATES,
      (locale, state) => seaStateText(diverTranslator(locale), state).label,
    ),
  },
  {
    module: "unit-labels.ts",
    map: "SEA_STATE_DETAIL_KEYS",
    rows: codeRows(
      SEA_STATES,
      (locale, state) => seaStateText(diverTranslator(locale), state).detail,
    ),
  },
  {
    module: "unit-labels.ts",
    map: "WIND_STATE_KEYS",
    rows: codeRows(WIND_STATES, (locale, state) => windText(diverTranslator(locale), state).label),
  },
  {
    module: "unit-labels.ts",
    map: "WIND_STATE_DETAIL_KEYS",
    rows: codeRows(WIND_STATES, (locale, state) => windText(diverTranslator(locale), state).detail),
  },
  {
    module: "waiver-labels.ts",
    map: "WAIVER_STATUS_KEYS",
    rows: codeRows(WAIVER_ROW_STATES, (locale, state) =>
      waiverRowStateText(staffTranslator(locale), state),
    ),
  },
];

/** `Object.keys` that keeps the key type, for a map the domain layer proved exhaustive. */
function keysOf<Code extends string>(map: Record<Code, unknown>): readonly Code[] {
  return Object.keys(map) as Code[];
}

/**
 * **`MAP.code` for every label that is the same string in both locales, and
 * why.** Each one is a proper noun or a loanword the Spanish diving world uses
 * untranslated, and the reason is per entry because a blanket exemption is how
 * the untranslated-Spanish catch gets given away.
 *
 * Asserted as *equal*, not merely skipped: if a translator ever decides one of
 * these does have a Spanish form, this file says so in one failing line and the
 * fix is deleting the entry.
 *
 * **This list stays now that `check:locale` counts identical values too**
 * (issue #1757), because the two make different claims. That guard compares
 * two bundle *values*; this compares two *rendered* labels, and a resolver
 * sits between them — it interpolates, it translates a second code into a
 * placeholder, and `KIND_SOURCES` redirects half its codes into another
 * module's keys. Two identical bundle values are therefore neither necessary
 * nor sufficient for the label a reader sees being identical, and the guard
 * cannot address a code at all: it knows `shared.compass.n`, not
 * `COMPASS_KEYS.n`. The guard carries the bundle-wide fact and its own
 * per-key reasons; this carries the per-code one. Neither is the other's
 * baseline.
 */
const SAME_IN_BOTH_LOCALES = new Map<string, string>([
  // "Plan" is spelled and read the same in Spanish.
  ["DIVER_FACT_SOURCE_KEYS.plan", "the same word in both languages"],
  // The agency course names, which Spanish-speaking shops use in English —
  // `rescue` is the exception and is translated ("Buceador de Rescate").
  ["CERTIFICATION_LEVEL_KEYS.open_water", "course name, used untranslated"],
  ["CERTIFICATION_LEVEL_KEYS.advanced_open_water", "course name, used untranslated"],
  ["CERTIFICATION_LEVEL_KEYS.divemaster", "course name, used untranslated"],
  ["CERTIFICATION_LEVEL_KEYS.instructor", "course name, used untranslated"],
  ["DIVER_CERTIFICATION_LEVEL_KEYS.open_water", "course name, used untranslated"],
  ["DIVER_CERTIFICATION_LEVEL_KEYS.advanced_open_water", "course name, used untranslated"],
  ["DIVER_CERTIFICATION_LEVEL_KEYS.divemaster", "course name, used untranslated"],
  ["DIVER_CERTIFICATION_LEVEL_KEYS.instructor", "course name, used untranslated"],
  // Training-agency acronyms: brand names, and `other` is the one real word in
  // the map — which is the whole reason the map is bundled at all.
  ["DIVER_CERTIFICATION_AGENCY_KEYS.padi", "agency acronym"],
  ["DIVER_CERTIFICATION_AGENCY_KEYS.ssi", "agency acronym"],
  ["DIVER_CERTIFICATION_AGENCY_KEYS.naui", "agency acronym"],
  ["DIVER_CERTIFICATION_AGENCY_KEYS.sdi", "agency acronym"],
  ["DIVER_CERTIFICATION_AGENCY_KEYS.tdi", "agency acronym"],
  ["DIVER_CERTIFICATION_AGENCY_KEYS.cmas", "agency acronym"],
  ["DIVER_CERTIFICATION_AGENCY_KEYS.raid", "agency acronym"],
  ["DIVER_CERTIFICATION_AGENCY_KEYS.gue", "agency acronym"],
  ["DIVER_CERTIFICATION_AGENCY_KEYS.bsac", "agency acronym"],
  // The five compass points Spanish spells with the same letter. The three it
  // does not — O, SO, NO — are the whole reason `compass-labels.ts` exists, so
  // they are deliberately absent from this list and asserted as different.
  ["COMPASS_KEYS.n", "same letter on both compasses"],
  ["COMPASS_KEYS.ne", "same letters on both compasses"],
  ["COMPASS_KEYS.e", "same letter on both compasses"],
  ["COMPASS_KEYS.se", "same letters on both compasses"],
  ["COMPASS_KEYS.s", "same letter on both compasses"],
  // The gear register's brand and initialism, and the prep list's own copy of
  // the first — one word, resolved through two maps.
  ["KIND_SOURCES.gopro", "brand name"],
  ["KIND_SOURCES.dpv", "initialism, used untranslated"],
  ["RENTAL_ITEM_LABEL_KEYS.gopro", "brand name"],
  // The diver bundle's copy of the same ladder the staff bundle allowlists
  // above, `rescue` excepted the same way.
  ["DIVER_CERT_LEVEL_KEYS.open_water", "course name, used untranslated"],
  ["DIVER_CERT_LEVEL_KEYS.advanced_open_water", "course name, used untranslated"],
  ["DIVER_CERT_LEVEL_KEYS.divemaster", "course name, used untranslated"],
  ["DIVER_CERT_LEVEL_KEYS.instructor", "course name, used untranslated"],
  // The diver's own chip for the same category *is* translated ("La sesión
  // informativa"); the staff panel's one-word version keeps the loanword a
  // crew says out loud.
  ["STAFF_PULSE_CATEGORY_KEYS.briefing", "loanword the Spanish diving world uses"],
  // A gas and a processor.
  ["ACTION_KIND_KEYS.nitrox_gate", "gas name, used untranslated"],
  ["ACTION_KIND_KEYS.stuck_payment_operation", "the processor’s brand name"],
  // The abbreviation is the whole message — "{value} m" carries no word to
  // translate. The spelled-out forms (`course.depthUnits.*`) do, and differ.
  ["DEPTH_UNIT_KEYS.meters", "the unit’s abbreviation, and the template is nothing else"],
  ["DEPTH_UNIT_KEYS.feet", "the unit’s abbreviation, and the template is nothing else"],
]);

/** A rendered label that is nothing but a dotted key — what a missing key renders as. */
const BARE_KEY = /^[A-Za-z][\w]*(\.[\w]+)+$/;

const OTHER_LOCALES = DIVER_LOCALES.filter((locale) => locale !== DEFAULT_DIVER_LOCALE);

describe.each(CASES)("$module › $map", ({ rows, map }) => {
  it("has a code to render at all", () => {
    // Guards the guard: a map whose code list went empty would pass every
    // assertion below without rendering anything.
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(DIVER_LOCALES)("resolves every code to a sentence in %s", (locale) => {
    for (const { code, silent, render } of rows) {
      const label = render(locale);
      if (silent) {
        expect(label, code).toBeNull();
        continue;
      }
      expect(label, code).not.toBeNull();
      expect(label?.trim(), code).not.toBe("");
      // A key no bundle holds renders as the dotted key itself. In this suite
      // it never gets that far — `translatorOnError` rethrows the
      // MISSING_MESSAGE first, which is the louder answer and the one a dev
      // server and an e2e run give too. The assertion stays because that
      // rethrow is one `isProduction()` away from being swallowed, and this is
      // what would keep a dotted key from passing as a sentence if it were.
      expect(label, code).not.toMatch(BARE_KEY);
      // A placeholder no resolver filled would survive to the screen — in
      // production, where `translatorOnError` swallows rather than throws.
      expect(label, code).not.toMatch(/[{}]/);
      // And a label that is its own domain code is a word nobody wrote — held
      // only for a compound code, because a single lowercase word genuinely is
      // the copy in three places here ("pending", "parent", "never" all sit at
      // the tail of a staff sentence). Nothing in either bundle is snake_case,
      // so a code with an underscore on screen is unambiguous.
      if (code.includes("_")) expect(label, code).not.toBe(code);
    }
  });

  it.each(OTHER_LOCALES)("speaks %s rather than falling back to the English", (locale) => {
    for (const { code, silent, render } of rows) {
      if (silent) continue;
      const reason = SAME_IN_BOTH_LOCALES.get(`${map}.${code}`);
      const translated = render(locale);
      const english = render(DEFAULT_DIVER_LOCALE);
      if (reason === undefined) {
        expect(translated, `${code} reads as English in ${locale}`).not.toBe(english);
      } else {
        // Allowlisted, and held to it: see SAME_IN_BOTH_LOCALES.
        expect(translated, `${code} — ${reason}`).toBe(english);
      }
    }
  });
});

/**
 * **The half a guard is good at.**
 *
 * A table proves what is in it. This finds every `Record<…MessageKey…>` in the
 * directory and requires the table to hold exactly those maps, so a map added
 * tomorrow fails here rather than joining the twenty-four that had no proof
 * for months. It is a text scan for the same reason
 * `provider-coverage.test.ts` is: the maps it looks for are private to their
 * modules and there is nothing to import.
 */
const I18N_DIR = path.join(process.cwd(), "src/i18n");

/** Comments in this directory quote map literals constantly — never scan them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Every `const NAME: Record<…>` whose type arguments name a message key.
 *
 * The type arguments are read by balancing angle brackets rather than by
 * matching up to the first `>`: `Record<Exclude<ThreadStepState, "done">,
 * DiverMessageKey>` closes its first `>` inside the key type, and a scan that
 * stopped there would miss the map and report the directory clean.
 */
function messageKeyMaps(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\bconst\s+([A-Za-z0-9_]+)\s*:\s*Record</g)) {
    const name = match[1];
    let depth = 0;
    let end = source.indexOf("<", match.index);
    for (let index = end; index < source.length; index += 1) {
      if (source[index] === "<") depth += 1;
      else if (source[index] === ">") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (source.slice(match.index, end).includes("MessageKey")) found.push(name);
  }
  return found;
}

describe("the directory's message-key maps", () => {
  it("accounts for every one of them, and holds the table to exactly them", async () => {
    const accounted = new Set(CASES.map((entry) => `${entry.module} ${entry.map}`));
    const found: string[] = [];
    const unaccounted: string[] = [];
    const modules = (await readdir(I18N_DIR)).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts"),
    );

    for (const module of modules.sort()) {
      const source = stripComments(await readFile(path.join(I18N_DIR, module), "utf8"));
      for (const map of messageKeyMaps(source)) {
        found.push(`${module} ${map}`);
        if (!accounted.has(`${module} ${map}`)) unaccounted.push(`${module} ${map}`);
      }
    }

    expect(unaccounted).toEqual([]);
    // The other direction, which is what a deferral list used to hide: with
    // every map in the table the two sets are equal, so a row whose map was
    // renamed or deleted fails here rather than sitting on as a row that
    // renders something nothing reads. It also means a scan that found nothing
    // cannot read as clean.
    expect([...accounted].sort()).toEqual([...found].sort());
  });

  it("finds the maps it claims to, so a broken scan can't read as clean", async () => {
    // Guards the guard. `READINESS_BLOCKER_KEYS` is private and
    // `THREAD_STEP_STATE_KEYS` is the nested-generic case, so between them they
    // fail if either half of the scan stops working.
    const readiness = stripComments(
      await readFile(path.join(I18N_DIR, "readiness-labels.ts"), "utf8"),
    );
    const thread = stripComments(await readFile(path.join(I18N_DIR, "thread-labels.ts"), "utf8"));

    expect(messageKeyMaps(readiness)).toContain("READINESS_BLOCKER_KEYS");
    expect(messageKeyMaps(thread)).toContain("THREAD_STEP_STATE_KEYS");
    expect(messageKeyMaps("const TONES: Record<Status, BadgeTone> = {};")).toEqual([]);
  });
});
