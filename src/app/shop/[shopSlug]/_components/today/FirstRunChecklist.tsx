"use client";

import Link from "next/link";
import { Copyable } from "@/components/Copyable";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import { SettledCheck } from "@/components/ui/SettledCheck";

/**
 * A new, real shop's Today is otherwise an empty work queue. This replaces
 * that blank landing with five persisted setup checks plus two guided actions
 * (schedule a trip and share its public link). Each completion state comes
 * from a real query, never a dismiss-and-forget flag.
 *
 * **Day zero is a state of the home, never a wizard** (ADR
 * 20260827-first-light, decision 6, in the grammar ADR
 * 20260827-clearwater-surface-language gives every other surface). The
 * primary-tinted card of nested step boxes is one **First morning** ledger
 * group, and the group is the day spine's *leading* group rather than a panel
 * standing in its place: `DaySpine` renders it above the stations, so day zero
 * reads as one more state of the same column of work every other morning is.
 *
 * Three shapes, and an open step is exactly one of them:
 *
 * - **Settled** — a done step is a line carrying {@link SettledCheck}'s drawn
 *   mark and the fact it settled on, with nothing left to press.
 * - **The one primary** — exactly one open step carries the page's one
 *   primary-weight button: the next thing to do.
 * - **A door** — every other open step *is* the link, the destination named on
 *   the stretched overlay and a quiet chevron for everyone else (principle 10,
 *   "actions ride on their objects"). Seven rows each offering a button is
 *   seven next actions, which is none.
 *
 * Everything the shipped checklist already owned is unchanged underneath: the
 * five persisted facts, the `countShopTrips === 0` condition, the demo
 * exclusion, `FIRST_RUN_STEP_COUNT`, `Copyable` on the schedule-link row, the
 * Stripe row's plain `<a>` (its route 302s to Stripe's OAuth authorize URL,
 * which Next's client navigation cannot follow, so that one step is a link
 * beside the row rather than the row itself), and the `data-first-run-primary`
 * hook the onboarding e2e reads to prove there is exactly one.
 *
 * The group exists only while the shop has no departure at all, and never
 * comes back.
 */

export type FirstRunChecklistCopy = {
  groupLabel: string;
  subtitle: string;
  progress: string;
  contactTitle: string;
  contactBody: string;
  contactAction: string;
  contactDone: string;
  profileTitle: string;
  profileBody: string;
  profileAction: string;
  profileDone: string;
  unitsTitle: string;
  unitsBody: string;
  unitsAction: string;
  unitsDone: string;
  siteTitle: string;
  siteBody: string;
  siteAction: string;
  siteDone: string;
  tripTitle: string;
  tripBody: string;
  tripAction: string;
  scheduleTitle: string;
  scheduleBody: string;
  scheduleCopy: string;
  scheduleCopied: string;
  scheduleCopyFailed: string;
  stripeTitle: string;
  stripeBody: string;
  stripeAction: string;
  stripeDone: string;
  doneBadge: string;
};

/**
 * The fix on an open step that is not the next one: the destination's name and
 * a chevron, in the row's own type — the same trailing a day-spine row that
 * merely navigates carries.
 *
 * `hidden` for a row whose whole surface is the link: the stretched overlay
 * already carries the destination's name, so repeating it here would read it
 * twice.
 */
function StepDoorLabel({ label, hidden = false }: { label: string; hidden?: boolean }) {
  return (
    <span
      aria-hidden={hidden || undefined}
      className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary"
    >
      {label}
      <DiveDayIcon name="chevron-right" className="size-4" />
    </span>
  );
}

function ChecklistStep({
  title,
  body,
  done,
  doneLabel,
  doneBadge,
  href,
  actionLabel,
  primary,
}: {
  title: string;
  body: string;
  done: boolean;
  doneLabel: string;
  doneBadge: string;
  href: string;
  actionLabel: string;
  /** This is the one open step carrying the page's primary. */
  primary: boolean;
}) {
  // One object, not two props: `LedgerRow`'s door is a union, so a row can
  // never reach a reader as a link with no accessible name. A step holding the
  // primary is deliberately *not* a door — the button beside it is the tap,
  // and a stretched overlay under it would be a second one.
  const door = done || primary ? {} : { href, linkLabel: actionLabel };
  return (
    <LedgerRow
      // A settled step says so in words as well as in the mark — `SettledCheck`
      // has no way to be used as a bare tick — and it stands where that step's
      // button used to be, so a finished row offers nothing to press.
      trailing={
        done ? (
          <SettledCheck settled label={doneBadge} />
        ) : primary ? (
          <Link
            href={href}
            data-first-run-primary="true"
            className={buttonClass({ size: "sm", variant: "primary" })}
          >
            {actionLabel}
          </Link>
        ) : (
          <StepDoorLabel label={actionLabel} hidden />
        )
      }
      {...door}
    >
      <div className="min-w-0 py-2">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted">{done ? doneLabel : body}</p>
      </div>
    </LedgerRow>
  );
}

export function FirstRunChecklist({
  shopSlug,
  scheduleUrl,
  contactDone,
  profileDone,
  diveSiteCount,
  unitsDone,
  stripeDone,
  copy,
}: {
  shopSlug: string;
  scheduleUrl: string;
  contactDone: boolean;
  profileDone: boolean;
  diveSiteCount: number;
  /** The shop has saved its units at least once — see the step below. */
  unitsDone: boolean;
  stripeDone: boolean;
  copy: FirstRunChecklistCopy;
}) {
  const siteDone = diveSiteCount > 0;
  // The trip row is intentionally the step that keeps this group visible: it
  // only mounts before the first departure exists. It stays an actionable step
  // rather than pretending a scheduled trip is complete.
  const nextStep = !contactDone
    ? "contact"
    : !profileDone
      ? "profile"
      : !unitsDone
        ? "units"
        : !siteDone
          ? "site"
          : "trip";

  return (
    <LedgerGroup as="h2" id="first-run-heading" label={copy.groupLabel} meta={copy.progress}>
      <p className="mt-2 text-sm text-muted">{copy.subtitle}</p>
      <ol className="mt-3">
        <ChecklistStep
          title={copy.contactTitle}
          body={copy.contactBody}
          done={contactDone}
          doneLabel={copy.contactDone}
          doneBadge={copy.doneBadge}
          // Straight to the open contact row — the settings hub keeps its forms
          // behind summary rows, and a link that promises a form must land on
          // it open.
          href={`/shop/${shopSlug}/settings#contact`}
          actionLabel={copy.contactAction}
          primary={nextStep === "contact"}
        />
        <ChecklistStep
          title={copy.profileTitle}
          body={copy.profileBody}
          done={profileDone}
          doneLabel={copy.profileDone}
          doneBadge={copy.doneBadge}
          href={`/shop/${shopSlug}/settings#profile`}
          actionLabel={copy.profileAction}
          primary={nextStep === "profile"}
        />
        {/* **The two settings the shop never chose.** Onboarding derives both
            from the timezone it picked (`src/lib/curated-defaults.ts`), and
            both are expensive to get wrong: `price_cents` counts the *current*
            currency's minor unit, and a depth typed under the wrong unit was
            converted on the way in. So the shop is asked to look, once, before
            it has priced anything (issue #712). */}
        <ChecklistStep
          title={copy.unitsTitle}
          body={copy.unitsBody}
          done={unitsDone}
          doneLabel={copy.unitsDone}
          doneBadge={copy.doneBadge}
          href={`/shop/${shopSlug}/settings#units`}
          actionLabel={copy.unitsAction}
          primary={nextStep === "units"}
        />
        <ChecklistStep
          title={copy.siteTitle}
          body={copy.siteBody}
          done={siteDone}
          doneLabel={copy.siteDone}
          doneBadge={copy.doneBadge}
          // The **library**, not its blank form (slice 10d). A shop with no
          // sites is offered two doors there — write one, or take one of the
          // 34 published Florida templates — and a link that lands straight on
          // an empty form has quietly made that choice for them
          // (ADR 20260827-the-shops-shelves).
          href={`/shop/${shopSlug}/dive-sites`}
          actionLabel={copy.siteAction}
          primary={nextStep === "site"}
        />
        <ChecklistStep
          title={copy.tripTitle}
          body={copy.tripBody}
          // The whole group only renders while the shop has no upcoming trip,
          // so this step is never done at render time.
          done={false}
          doneLabel={copy.tripTitle}
          doneBadge={copy.doneBadge}
          href={`/shop/${shopSlug}/schedule/board?add=1`}
          actionLabel={copy.tripAction}
          primary={nextStep === "trip"}
        />
        <LedgerRow
          trailing={
            <Copyable
              layout="inline"
              value={scheduleUrl}
              copyLabel={copy.scheduleCopy}
              copiedLabel={copy.scheduleCopied}
              failedLabel={copy.scheduleCopyFailed}
            />
          }
        >
          {/* `min-w-0`, or the `truncate` below never fires: a flex item
              defaults to `min-width:auto`, so the row grows to its widest child
              — the URL — and pushes the page wider than the viewport instead of
              clipping it. */}
          <div className="min-w-0 py-2">
            <p className="font-medium">{copy.scheduleTitle}</p>
            <p className="mt-0.5 text-sm text-muted">{copy.scheduleBody}</p>
            <p className="mt-1 max-w-full truncate font-mono text-xs text-muted">{scheduleUrl}</p>
          </div>
        </LedgerRow>
        {/* **The one step that is not the row.** Every other open step is a
            door — the row itself, stretched over a `<Link>`. This one cannot
            be: its route 302s to Stripe's OAuth authorize URL, and Next's
            client-side navigation would follow that redirect via fetch, a
            cross-origin request Stripe's CORS policy rejects. So the fix sits
            beside the row as a plain `<a>` doing a full navigation, wearing
            the same words and chevron the doors wear. */}
        <LedgerRow
          trailing={
            stripeDone ? (
              <SettledCheck settled label={copy.doneBadge} />
            ) : (
              <a href={`/shop/${shopSlug}/settings/connect`} className="hover:underline">
                <StepDoorLabel label={copy.stripeAction} />
              </a>
            )
          }
        >
          <div className="min-w-0 py-2">
            <p className="font-medium">{copy.stripeTitle}</p>
            <p className="mt-0.5 text-sm text-muted">
              {stripeDone ? copy.stripeDone : copy.stripeBody}
            </p>
          </div>
        </LedgerRow>
      </ol>
    </LedgerGroup>
  );
}
