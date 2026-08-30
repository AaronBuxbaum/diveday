import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { LedgerRow } from "@/components/ui/ledger";
import { CERTIFICATION_ROW_STATE_BADGE } from "@/i18n/card-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type WaiverRowState, waiverRowStateText, waiverRowStateTone } from "@/i18n/waiver-labels";
import type { CertificationCardRowState } from "@/lib/certification-cards";

/**
 * **The three rows every people surface repeats** — ADR
 * 20260827-people-not-lists, decision 6: "the same certification card row,
 * waiver-state row and money fact render on the record, the counter, and the
 * trip roster — one component each, so 'verify a card' looks identical
 * wherever a staffer meets it."
 *
 * Before this file the certification row existed twice (`CertificationCards`
 * and `SpecialtyCards`, ~660 lines of near-identical markup), the waiver-state
 * row was a tone-tinted card body, and a booking's money fact was a third
 * shape again. Three spellings of three facts a staffer reads dozens of times a
 * day.
 *
 * Four rules hold across all three, and each one is pinned in `rows.test.tsx`:
 *
 * - **A badge marks the exceptional state, never the expected one**
 *   (20260827-clearwater-surface-language, decision 3). A certified card
 *   renders no badge at all; a signed waiver renders no colour. The silence is
 *   the design, which is why the tests assert absence as hard as presence.
 * - **Colour never carries a state alone.** Every non-expected state renders a
 *   word, and the drawn tone mark rides the badge for the pass/fail tones.
 * - **These rows compose no copy and format no value.** `date`, `meta` and a
 *   money `label` arrive pre-formatted, locale- and timezone-aware, from the
 *   caller — no row here constructs an `Intl` formatter, which is also what
 *   keeps `pnpm check:timezone` honest about the surface that renders them.
 *   The only words a row reaches for itself are the ones a *state* implies,
 *   and those come from the shared tables in `src/i18n/card-labels.ts` and
 *   `src/i18n/waiver-labels.ts` — never a second mapping local to this file.
 * - **They are server-rendered.** `t` is a `StaffTranslator`, and staff copy
 *   never crosses to the client (`src/i18n/staff-messages.ts`); a staff Client
 *   Component takes its words as props.
 *
 * The certification and waiver rows are shaped for `InsetGroup` — the file's
 * grammar — so they pad themselves and let the group draw the hairline between
 * them. The booking row is a `LedgerRow`, because the story is one open ledger.
 */

/** The self-padding a row inside an `InsetGroup` carries, matching the settings rows. */
const FILE_ROW_CLASS =
  "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6";

/**
 * **A certification card, on the record and anywhere else a card is met.**
 *
 * `state` is computed once by `certificationCardRowState`
 * (`src/lib/certification-cards.ts`) and never re-derived here. That matters
 * more than it looks: flattening the two shipped display unions into four
 * values is exactly where H-24 gets lost — an imported *level* card genuinely
 * clears and an imported *specialty* or *nitrox* card does not — and a row
 * component that recomputed it from a `kind` prop would be the second place
 * that rule could drift. So the SPEC's `kind` prop lives on the mapper
 * instead, where kind is the only thing it decides.
 *
 * The imported marker is **structural, not a caller's detail string**: a card
 * that came across from another system says so on every surface that shows it
 * (ADR 20260724-import-verified-cards), including the ones whose state reads
 * plain `verified`. A bare tint has never been allowed to carry that fact.
 */
export function CertificationCardRow({
  t,
  title,
  detail,
  state,
  imported,
  actions,
  actionsId,
  as: Tag = "li",
}: {
  t: StaffTranslator;
  /** The card in words — "PADI Open Water". Composed by the caller. */
  title: ReactNode;
  /** The card's small print — "card · last four · added Wed by the recorder". Pre-formatted. */
  detail?: ReactNode;
  state: CertificationCardRowState;
  /** Set for a card the importer brought across; `source` names the old system when known. */
  imported?: { source?: string | null };
  /** Verify / Remove, per the caller's permissions. */
  actions?: ReactNode;
  /**
   * Marks this row's action group as the target of a fragment link — the
   * status ledger's "Verify it" lands here and puts the cursor beside the
   * control.
   *
   * **An id, never a wrapper.** It was a `<span id>` the caller conditionally
   * wrapped `actions` in, and moving the anchor changed the element *type* of
   * the subtree: React unmounted the control underneath it and every
   * `useActionState` result inside died. Marking a card verified is exactly
   * what moves the anchor, so the confirmation of that act — and the Undo it
   * carries — were destroyed by their own success. The group renders
   * unconditionally now and only the attributes move.
   */
  actionsId?: string;
  as?: "li" | "div";
}) {
  const badge = CERTIFICATION_ROW_STATE_BADGE[state];
  const marker = imported
    ? imported.source
      ? t("divers.certifications.importedWithSource", { source: imported.source })
      : t("divers.certifications.importedLabel")
    : null;
  return (
    <Tag className={FILE_ROW_CLASS}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {badge ? (
            <Badge tone={badge.tone} size="sm">
              {t(badge.key)}
            </Badge>
          ) : null}
        </p>
        {detail || marker ? (
          <p className="mt-1 break-words text-sm text-muted">
            {detail}
            {detail && marker ? " · " : null}
            {marker}
          </p>
        ) : null}
      </div>
      {actions || actionsId ? (
        // `tabIndex` so a fragment link both scrolls here *and* puts the cursor
        // beside the control.
        <div
          id={actionsId}
          tabIndex={actionsId ? -1 : undefined}
          className="flex flex-wrap items-center gap-2"
        >
          {actions}
        </div>
      ) : null}
    </Tag>
  );
}

/**
 * Tone in the ink rather than in a second pill — `LedgerRow`'s own rule. A
 * current release is the expected state and wears no colour at all: there is
 * nothing exceptional about a diver who has signed.
 */
const WAIVER_TONE_INK = {
  success: "",
  warning: "text-warning",
  danger: "text-danger",
} as const;

/**
 * **The waiver, as one row**: where the release stands, why, and the routes to
 * get it signed.
 *
 * The four standings come from `shopWaiverStatus`; `failed` is the delivery
 * outcome sitting orthogonal to them (`src/i18n/waiver-labels.ts` explains the
 * asymmetry). A failure never renders mute: with no `detail` supplied the row
 * states the delivery failure itself, because "Not signed" in red with no
 * sentence is a colour carrying a fact on its own.
 */
export function WaiverStateRow({
  t,
  state,
  detail,
  actions,
  as: Tag = "li",
}: {
  t: StaffTranslator;
  state: WaiverRowState;
  /** "signed Wed, Aug 26 · release v4" — or the failure sentence. Pre-formatted. */
  detail?: ReactNode;
  /** The send routes, disclosed. */
  actions?: ReactNode;
  as?: "li" | "div";
}) {
  const tone = waiverRowStateTone(state);
  const sentence = detail ?? (state === "failed" ? t("divers.stats.waiverFailed") : null);
  return (
    <Tag className={FILE_ROW_CLASS}>
      <div className="min-w-0">
        <p className={`font-medium ${WAIVER_TONE_INK[tone]}`.trim()}>
          {waiverRowStateText(t, state)}
        </p>
        {sentence ? <p className="mt-1 text-sm text-muted">{sentence}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </Tag>
  );
}

/** What a booking's money stands at, on the booking's own row. */
export type BookingStoryMoney = {
  state: "paid" | "open" | "refunded";
  /** The money fact in words, already formatted in the reader's locale and currency. */
  label: string;
};

/**
 * Settled money is quiet. A "Paid" pill down every row of a diver's history is
 * a badge marking the expected state — the reading `ORDER_STATUS_TONES` already
 * gives for the Orders index, where `paid` deliberately renders no badge at
 * all. An open balance and a refund are the two a staffer is scanning for, and
 * they keep the order vocabulary's own tones so one seat cannot read as two
 * different facts on two screens.
 */
function BookingMoneyFact({ money }: { money: BookingStoryMoney }) {
  if (money.state === "paid") {
    return <span className="text-sm text-muted tabular-nums">{money.label}</span>;
  }
  return (
    <Badge tone={money.state === "open" ? "primary" : "warning"} size="sm" tabularNums>
      {money.label}
    </Badge>
  );
}

/**
 * **One line of the diver's story**: a date, what it was, and what money did.
 *
 * Two kinds of row share the list and must never read alike (ADR
 * 20260725-import-prior-visits): a DiveDay booking points at a departure this
 * shop ran, and an imported row is a booking record the previous system held —
 * evidence a seat was reserved, not evidence anybody got in the water. So an
 * imported row is marked and **is not a door**, whatever `href` a caller
 * passes: there is no trip here to open, and a link that navigates nowhere is a
 * worse answer than no link.
 */
export function BookingStoryRow({
  t,
  date,
  title,
  meta,
  money,
  href,
  linkLabel,
  past,
  imported,
}: {
  t: StaffTranslator;
  /** Pre-formatted, locale- and timezone-aware — "Thu, Aug 27". */
  date: string;
  title: string;
  /** "7:00 AM · waiver signed". Pre-formatted. */
  meta?: string;
  /** Omitted when nothing has been raised: an absence is not a fact worth a pill. */
  money?: BookingStoryMoney;
  href?: string;
  /** The destination in words, for the whole-row link. Falls back to the title. */
  linkLabel?: string;
  past?: boolean;
  imported?: boolean;
}) {
  // One object, not two props. `LedgerRow`'s door is a union — a row either
  // carries both `href` and a `linkLabel` or neither — so that a whole-row
  // link can never ship unnamed, with the row's own text sitting behind it
  // where a screen reader cannot reach it (`ledger.tsx`, 6a). Two independent
  // ternaries are the same thing at runtime and TypeScript cannot see it:
  // spreading one value is what lets the compiler check the pair.
  const door = imported || !href ? {} : { href, linkLabel: linkLabel ?? title };
  const marker = imported ? t("divers.history.imported") : null;
  return (
    <LedgerRow
      {...door}
      trailing={money ? <BookingMoneyFact money={money} /> : null}
      className="py-3"
    >
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
        <span className="shrink-0 text-sm text-muted tabular-nums sm:w-28">{date}</span>
        <span className="min-w-0">
          <span className={`block font-medium ${past ? "text-muted" : ""}`.trim()}>{title}</span>
          {meta || marker ? (
            <span className="block text-sm text-muted">
              {meta}
              {meta && marker ? " · " : null}
              {marker}
            </span>
          ) : null}
        </span>
      </div>
    </LedgerRow>
  );
}
