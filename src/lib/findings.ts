import type { CertificationLevel } from "./certification-levels";
import type { CourseCrewGap, CourseCrewRemedy, CourseRatioKind } from "./course-ratios";
import type { DepthCeilingCheck, DepthLimitBasis, JuniorVerificationReason } from "./depth-ceiling";
import type { DepthUnit } from "./depth-units";
import { type DiveRecencyBand, diveRecencyIsNotable } from "./dive-recency";
import type { DivemasterRatioGap } from "./divemaster-ratio";
import type { MinimumSeatsState } from "./minimum-seats";
import type { ReadinessBlocker, ReadinessBlockerCode, ReadinessStatus } from "./readiness";

/**
 * **One vocabulary for everything DiveDay says about a seat or a departure.**
 *
 * A *finding* is a `{ code, params }` the evaluators return and the UI looks up
 * in a bundle. Each code has one **strictness** (`FINDING_STRICTNESS`), and that
 * one row is the only place DiveDay records whether a finding holds a diver off
 * the boat:
 *
 * - **`blocks`**: a readiness blocker (`ReadinessBlockerCode`). Any one of them
 *   makes the booking `blocked`.
 * - **`informs`**: an *advisory*, a finding at strictness zero. A depth past the
 *   diver's ceiling, a long time since the last dive, a course session short of
 *   crew, a boat under the shop's divemaster target, a departure short of its
 *   minimum, a safety checklist not yet ticked. Each one is for a person to
 *   read and decide; none of them can make a diver `blocked`.
 *
 * **Advisories never gate boarding.** That rule is held three ways, so one
 * slip cannot break it:
 *
 * 1. **By type.** Blockers and advisories are two lists, never one:
 *    `ReadinessResult.blockers` holds `ReadinessBlocker`, whose code union
 *    excludes every advisory code (`_DisjointCodes` below fails to compile if a
 *    code is ever in both), and `calculateReadiness` takes no advisory input.
 *    The 95 places that read `.blockers` therefore cannot meet an advisory.
 * 2. **By table.** Moving a code from `informs` to `blocks` is not a one-row
 *    edit: the table's type is built from the two unions, so the code has to
 *    leave `AdvisoryCode` and join `ReadinessBlockerCode`, with its evaluator
 *    moving into `calculateReadiness`. That is a decision for the owner and an
 *    ADR (H-20260724-certification-levels-agency-rules for depth; H-20261025-shop-authored-pre-departure for the
 *    pre-departure check), never a refactor.
 * 3. **By status.** `findingsStatus` reads the table, fails closed (a code it
 *    does not know blocks) and is what `calculateReadiness` returns as status.
 *
 * Strictness here is about **boarding**. A course's agency ratio is also a
 * *sale* cap that refuses a seat in `createBookingRecord`
 * (`src/lib/course-ratios.ts`); that refusal happens before a booking exists,
 * and `course_over_ratio` is what is left to say about a session crewed below
 * it afterwards.
 *
 * **Subject.** A finding is about one booking (`BookingAdvisory`, beside a
 * seat's readiness) or about a whole departure (`DepartureAdvisory`), which is
 * meant for the trip's own row and never joins a diver's readiness. The types
 * keep the two apart; no runtime table is needed.
 *
 * Its only runtime import is `dive-recency.ts`, itself import-free, so the
 * offline manifest can read it without pulling the readiness pipeline in.
 */

/** Every advisory, in the order a surface lists them: the diver first, then the departure. */
export const ADVISORY_CODES = [
  "depth_exceeds_ceiling",
  "depth_verification_required",
  "recency_notable",
  "course_no_instructor",
  "course_over_ratio",
  "divemaster_under_target",
  "minimum_seats_due",
  "minimum_seats_short",
  "pre_departure_unchecked",
] as const;

export type AdvisoryCode = (typeof ADVISORY_CODES)[number];

export type FindingCode = ReadinessBlockerCode | AdvisoryCode;

export type FindingStrictness = "blocks" | "informs";

/**
 * Compile-time proof that no code is both a blocker and an advisory. If one
 * ever is, this resolves to `false` and the assignment below stops compiling.
 */
type _DisjointCodes = [Extract<ReadinessBlockerCode, AdvisoryCode>] extends [never] ? true : false;
const _disjointCodes: _DisjointCodes = true;
void _disjointCodes;

/**
 * **The one table.** Typed from the two unions, so a blocker code can only be
 * `"blocks"` and an advisory code only `"informs"`: changing a row means moving
 * the code between unions, which every `.blockers` reader then sees.
 */
export const FINDING_STRICTNESS: { readonly [C in ReadinessBlockerCode]: "blocks" } & {
  readonly [C in AdvisoryCode]: "informs";
} = {
  requirements_not_configured: "blocks",
  identity_unconfirmed: "blocks",
  waiver_not_sent: "blocks",
  waiver_lapsed: "blocks",
  waiver_runs_out: "blocks",
  waiver_pending: "blocks",
  medical_review: "blocks",
  medical_not_cleared: "blocks",
  waiver_seal_failed: "blocks",
  guardian_signature_missing: "blocks",
  course_form_unsigned: "blocks",
  course_form_guardian_missing: "blocks",
  training_mark_invalid: "blocks",
  certification_missing: "blocks",
  certification_pending: "blocks",
  certification_self_declared: "blocks",
  certification_insufficient: "blocks",
  certification_in_training: "blocks",
  certification_not_yet: "blocks",
  specialty_missing: "blocks",
  specialty_pending: "blocks",
  specialty_import_unconfirmed: "blocks",
  nitrox_missing: "blocks",
  nitrox_pending: "blocks",
  nitrox_self_declared: "blocks",
  under_minimum_age: "blocks",
  payment_due: "blocks",
  payment_refunded: "blocks",
  readiness_unavailable: "blocks",

  // A site maximum is not the dive plan (H-20260724-certification-levels-agency-rules).
  depth_exceeds_ceiling: "informs",
  depth_verification_required: "informs",
  // Currency is a briefing and a buddy pairing, not a refusal (ADR 20260821).
  recency_notable: "informs",
  // Enrolment is refused upstream; a session that later loses its instructor
  // must not enter the water. Staff act on it; the software holds no seats.
  course_no_instructor: "informs",
  // The in-water ratio still binds: the crew restores it (another instructor,
  // an assistant where one counts, or split groups) before the dive.
  course_over_ratio: "informs",
  // The shop's own target binds nothing (ADR 20260820-shop-divemaster-ratio).
  divemaster_under_target: "informs",
  // The sweep cancels a short departure; no diver is held for it.
  minimum_seats_due: "informs",
  minimum_seats_short: "informs",
  // Informs, never gates (ADR 20260824-pre-departure-safety-check; H-20261025-shop-authored-pre-departure open).
  pre_departure_unchecked: "informs",
};

export type DepthAdvisory =
  | {
      code: "depth_exceeds_ceiling";
      params: {
        /** Both already in the shop's unit and rounded for display. */
        siteDepth: number;
        limitDepth: number;
        unit: DepthUnit;
        basis: DepthLimitBasis;
        level: CertificationLevel | null;
        verificationReasons?: JuniorVerificationReason[];
      };
    }
  | {
      code: "depth_verification_required";
      params: { verificationReasons: JuniorVerificationReason[] };
    };

export type RecencyAdvisory = { code: "recency_notable"; params: { band: DiveRecencyBand } };

/** Advisories about one seat: these ride beside a booking's readiness. */
export type BookingAdvisory = DepthAdvisory | RecencyAdvisory;

export type CourseCrewAdvisory =
  | { code: "course_no_instructor"; params?: undefined }
  | {
      code: "course_over_ratio";
      params: {
        booked: number;
        capacity: number;
        ratio: CourseRatioKind;
        remedy: CourseCrewRemedy;
      };
    };

export type DivemasterAdvisory = {
  code: "divemaster_under_target";
  params: { divers: number; divemasterCount: number; needed: number; shortBy: number };
};

export type MinimumSeatsAdvisory = {
  code: "minimum_seats_short" | "minimum_seats_due";
  params: { minimum: number; shortfall: number; decidesAt: Date };
};

export type PreDepartureAdvisory = {
  code: "pre_departure_unchecked";
  params: { unchecked: number; total: number };
};

/** Advisories about the whole departure: these render on the trip's own row. */
export type DepartureAdvisory =
  | CourseCrewAdvisory
  | DivemasterAdvisory
  | MinimumSeatsAdvisory
  | PreDepartureAdvisory;

export type Advisory = BookingAdvisory | DepartureAdvisory;

export type Finding = ReadinessBlocker | Advisory;

/**
 * Status from findings, by the table. **Fails closed**: a code missing from
 * the table (a value that bypassed the types, a stale cached row) blocks, as
 * every unknown does in readiness. Only a code the table names `informs` is
 * let through.
 */
export function findingsStatus(findings: readonly { code: string }[]): ReadinessStatus {
  for (const finding of findings) {
    const strictness: FindingStrictness | undefined = Object.hasOwn(
      FINDING_STRICTNESS,
      finding.code,
    )
      ? FINDING_STRICTNESS[finding.code as FindingCode]
      : undefined;
    if (strictness !== "informs") return "blocked";
  }
  return "ready";
}

/* -------------------------------------------------------------------------- */
/* One adapter per advisory module: its own answer in, a finding or null out. */
/* -------------------------------------------------------------------------- */

/** `checkDepthCeiling`'s answer as a finding; `unknown` and `within` say nothing. */
export function depthFinding(check: DepthCeilingCheck | null | undefined): DepthAdvisory | null {
  if (!check) return null;
  if (check.status === "verification_required") {
    return {
      code: "depth_verification_required",
      params: { verificationReasons: check.verificationReasons },
    };
  }
  if (check.status !== "exceeds") return null;
  return {
    code: "depth_exceeds_ceiling",
    params: {
      siteDepth: check.siteDepth,
      limitDepth: check.limitDepth,
      unit: check.unit,
      basis: check.basis,
      level: check.level,
      ...(check.verificationReasons ? { verificationReasons: check.verificationReasons } : {}),
    },
  };
}

/** The two answers a divemaster would want to read twice (`diveRecencyIsNotable`). */
export function recencyFinding(band: DiveRecencyBand | null | undefined): RecencyAdvisory | null {
  return band != null && diveRecencyIsNotable(band)
    ? { code: "recency_notable", params: { band } }
    : null;
}

export function courseCrewFinding(gap: CourseCrewGap): CourseCrewAdvisory | null {
  if (gap.code === "no_instructor") return { code: "course_no_instructor" };
  if (gap.code !== "over_ratio") return null;
  return {
    code: "course_over_ratio",
    params: { booked: gap.booked, capacity: gap.capacity, ratio: gap.ratio, remedy: gap.remedy },
  };
}

export function divemasterFinding(gap: DivemasterRatioGap): DivemasterAdvisory | null {
  if (gap.code !== "under_target") return null;
  return {
    code: "divemaster_under_target",
    params: {
      divers: gap.divers,
      divemasterCount: gap.divemasterCount,
      needed: gap.needed,
      shortBy: gap.shortBy,
    },
  };
}

export function minimumSeatsFinding(state: MinimumSeatsState): MinimumSeatsAdvisory | null {
  if (state.kind !== "short" && state.kind !== "due") return null;
  return {
    code: state.kind === "due" ? "minimum_seats_due" : "minimum_seats_short",
    params: { minimum: state.minimum, shortfall: state.shortfall, decidesAt: state.decidesAt },
  };
}

/** A checklist with items left to tick. An empty checklist has nothing to say. */
export function preDepartureFinding(check: {
  checked: number;
  total: number;
}): PreDepartureAdvisory | null {
  const unchecked = check.total - check.checked;
  if (check.total <= 0 || unchecked <= 0) return null;
  return { code: "pre_departure_unchecked", params: { unchecked, total: check.total } };
}

/** The depth advisory among a seat's advisories, for the surfaces that render only depth. */
export function depthAdvisoryIn(
  advisories: readonly BookingAdvisory[] | null | undefined,
): DepthAdvisory | undefined {
  return advisories?.find(
    (advisory): advisory is DepthAdvisory =>
      advisory.code === "depth_exceeds_ceiling" || advisory.code === "depth_verification_required",
  );
}
