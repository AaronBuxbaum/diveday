import Link from "next/link";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { GroupLabel } from "@/components/ui/ledger";
import type { SignedWaiverEntry } from "@/db/waivers";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, groupByLocalDay } from "@/lib/calendar-date";
import { formatShortDate, formatTime } from "@/lib/format";

/**
 * **The signature log as a day-grouped ledger** (ADR 20260827-people-not-lists,
 * decision 4; the language is ADR 20260827-clearwater-surface-language).
 *
 * These rows are evidence. The shop's whole defence, if a release is ever
 * tested, is that it can read back who signed what and when — so the log's job
 * is to be walkable, and the day the signature was given is the fact a
 * reviewer navigates by. It is therefore the group's, stated once at the head
 * of each day rather than restated on every row (decision 2 of the language
 * ADR), and the row keeps only what is its own: who, which departure, what
 * time.
 *
 * Two rules the tests pin, and both are about *silence*:
 *
 * - **Integrity is a `Badge` only when it is not valid.** A sealed record that
 *   verifies is the expected state, and the shipped log wrote "Integrity
 *   verified" in green on every row — a page of green that trains a reader to
 *   stop looking, so the one row saying something else reads as more of the
 *   same. `Badge` is the app's only pill and it marks the exception
 *   (20260827-clearwater-surface-language, decision 3). The two exceptions each
 *   carry a word as well as a tone, because colour never carries a state alone.
 * - **A day group renders only over rows.** No heading stands above an
 *   absence; with nothing signed at all the log is one line
 *   (`signatures.noSignedRecords`).
 *
 * **A row is a door that does not navigate.** Opening one reveals the evidence
 * block in place — the release version the signature was given against, the
 * two records it belongs to, and any flagged medical prompt. That block is
 * where the medical detail lives, which is the same gating the trip roster
 * applies (`RosterSection.tsx`): the summary says a follow-up is flagged, and
 * the prompts themselves are one deliberate gesture away. Nothing here ever
 * renders the raw questionnaire — `src/db/waivers.ts` does not carry it.
 *
 * The links live in the block rather than on the summary on purpose: a link
 * inside a `<summary>` is a control nested in a control, which is both an axe
 * `nested-interactive` finding and a genuinely ambiguous tap target on the one
 * page whose rows a reviewer walks with a keyboard.
 */

/** The prefix `?record=` deep links resolve to, and the roster's link builds. */
export function signatureRowId(recordId: string) {
  return `waiver-record-${recordId}`;
}

function IntegrityBadge({ entry, t }: { entry: SignedWaiverEntry; t: StaffTranslator }) {
  if (entry.integrity === "valid") return null;
  const invalid = entry.integrity === "invalid";
  return (
    <Badge tone={invalid ? "danger" : "warning"} size="sm" className="shrink-0">
      {invalid
        ? t("waiversStaff.signatures.integrityInvalid")
        : t("waiversStaff.signatures.integrityUnsealed")}
    </Badge>
  );
}

function SignatureRow({
  entry,
  shopSlug,
  locale,
  timezone,
  t,
  pinned = false,
}: {
  entry: SignedWaiverEntry;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
  /**
   * The record a `?record=` deep link resolved — the roster's "View signed
   * record" is how a reviewer arrives here. It renders first inside its own
   * day group rather than being lifted out of the grouping into a pinned
   * section of its own: the day is the fact the reviewer is about to read the
   * neighbouring rows by, and a row hoisted above it has lost that. The rule
   * beside it is `--border-strong`, a structural mark rather than a state
   * colour, so it needs no word to carry it.
   *
   * It also opens itself, and that is deliberate on a surface holding medical
   * detail: the URL named this one record, the reviewer followed a link from a
   * `medical_review` hold to read exactly it, and the roster they came from
   * already lists the same flagged prompts inline to the same gated role.
   * Every *other* row on the page stays shut, which is the gate that matters —
   * the log at rest never renders a medical answer.
   */
  pinned?: boolean;
}) {
  const id = signatureRowId(entry.id);
  const trip =
    entry.tripId && entry.tripTitle
      ? `${entry.tripTitle}${
          entry.tripStartsAt ? ` · ${formatShortDate(entry.tripStartsAt, locale, timezone)}` : ""
        }`
      : t("waiversStaff.signatures.noTrip");
  return (
    <li
      className={`border-t border-border last:border-b${
        pinned ? " -ms-3 border-s-2 border-s-border-strong ps-3" : ""
      }`}
    >
      <AutoOpenDetails
        id={id}
        openOnHash={id}
        open={pinned}
        className="group/signature scroll-mt-24"
      >
        <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 py-2 transition-colors select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken/60">
          <span className="font-medium sm:w-52 sm:shrink-0">{entry.personName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{trip}</span>
          <IntegrityBadge entry={entry} t={t} />
          {/* The summary badge only — never the answers, which sit in the
              block below and are read by opening the row. */}
          {entry.flaggedPrompts.length > 0 ? (
            <Badge tone="warning" size="sm" className="shrink-0">
              {t("waiversStaff.signatures.medicalFlag")}
            </Badge>
          ) : null}
          {entry.signedAt ? (
            <span className="shrink-0 text-xs text-muted tabular-nums">
              {formatTime(entry.signedAt, locale, timezone)}
            </span>
          ) : null}
          <DisclosureCaret className="shrink-0 text-muted group-open/signature:rotate-90" />
        </summary>
        <div className="flex flex-col gap-3 pb-4 text-sm">
          <p className="text-muted tabular-nums">
            {t("waiversStaff.signatures.releaseVersion", { version: entry.templateVersion })}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link
              href={`/shop/${shopSlug}/divers/${entry.personId}`}
              className={buttonClass({ variant: "link", size: "sm", flush: true })}
            >
              {t("waiversStaff.signatures.openRecord")}
            </Link>
            {entry.tripId ? (
              <Link
                href={`/shop/${shopSlug}/trips/${entry.tripId}`}
                className={buttonClass({ variant: "link", size: "sm", flush: true })}
              >
                {t("waiversStaff.signatures.openTrip")}
              </Link>
            ) : null}
          </div>
          {entry.flaggedPrompts.length > 0 ? (
            <div>
              <GroupLabel as="h4">{t("waiversStaff.signatures.flaggedAnswersHeading")}</GroupLabel>
              <ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-warning-strong">
                {entry.flaggedPrompts.map((prompt) => (
                  <li key={prompt}>{prompt}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </AutoOpenDetails>
    </li>
  );
}

export function SignatureLog({
  entries,
  pinned,
  shopSlug,
  locale,
  timezone,
  t,
}: {
  /** This page of the audit, already stripped of `pinned` so it renders once. */
  entries: readonly SignedWaiverEntry[];
  /** The `?record=` record, resolved even when it falls on another page. */
  pinned?: SignedWaiverEntry | null;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  // The pinned record leads the merged list, so `groupByLocalDay` — which
  // keeps arrival order inside a day — puts it first in whichever day it
  // belongs to without anything having to sort within the group.
  const all = pinned ? [pinned, ...entries] : [...entries];
  const dated = all.filter((entry) => entry.signedAt !== null);
  // A completed record always carries its signing instant, but the column is
  // nullable, and a log that throws on the one malformed row is worse than a
  // log with a tail group. They cannot be grouped by a day they do not have.
  const undated = all.filter((entry) => entry.signedAt === null);
  const days = groupByLocalDay(dated, timezone, (entry) => entry.signedAt as Date).reverse();

  const rows = (group: readonly SignedWaiverEntry[]) =>
    group.map((entry) => (
      <SignatureRow
        key={entry.id}
        entry={entry}
        shopSlug={shopSlug}
        locale={locale}
        timezone={timezone}
        t={t}
        pinned={entry.id === pinned?.id}
      />
    ));

  return (
    <div className="space-y-8">
      {days.map(({ day, items }) => (
        <section key={day} aria-labelledby={`signed-${day}`}>
          <GroupLabel as="h3" id={`signed-${day}`}>
            {formatCalendarDate(day, locale)}
          </GroupLabel>
          <ul className="mt-2">{rows(items)}</ul>
        </section>
      ))}
      {undated.length > 0 ? (
        <section aria-labelledby="signed-undated">
          <GroupLabel as="h3" id="signed-undated">
            {t("waiversStaff.signatures.noSignatureDate")}
          </GroupLabel>
          <ul className="mt-2">{rows(undated)}</ul>
        </section>
      ) : null}
    </div>
  );
}
