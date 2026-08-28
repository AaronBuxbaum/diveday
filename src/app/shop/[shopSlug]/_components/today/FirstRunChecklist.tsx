"use client";

import Link from "next/link";
import { Copyable } from "@/components/Copyable";
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
 * primary-tinted card of nested step boxes became one ledger group under the
 * greeting: a done step is a settled line, an open step is a row with its one
 * fix beside it, and **exactly one open step carries the page's one primary** —
 * the next thing to do. Everything the shipped checklist already owned is
 * unchanged underneath: the five persisted facts, the `countShopTrips === 0`
 * condition, the demo exclusion, the step targets, `Copyable` on the
 * schedule-link row, the Stripe row's plain `<a>` (its route 302s to Stripe's
 * OAuth authorize URL, which Next's client navigation cannot follow), and the
 * `data-first-run-primary` hook the onboarding e2e reads to prove there is
 * exactly one.
 *
 * The group exists only while the shop has no departure at all, and never
 * comes back.
 */

export type FirstRunChecklistCopy = {
  heading: string;
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

function ChecklistStep({
  title,
  body,
  done,
  doneLabel,
  doneBadge,
  action,
}: {
  title: string;
  body: string;
  done: boolean;
  doneLabel: string;
  doneBadge: string;
  action?: React.ReactNode;
}) {
  return (
    <LedgerRow
      // A settled step says so in words as well as in the mark — `SettledCheck`
      // has no way to be used as a bare tick — and it stands where that step's
      // button used to be, so a finished row offers nothing to press.
      trailing={done ? <SettledCheck settled label={doneBadge} /> : action}
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
  const stepLink = (id: string, href: string, label: string) => (
    <Link
      href={href}
      data-first-run-primary={nextStep === id ? "true" : undefined}
      className={buttonClass({ size: "sm", variant: nextStep === id ? "primary" : "secondary" })}
    >
      {label}
    </Link>
  );

  return (
    <LedgerGroup as="h2" id="first-run-heading" label={copy.heading} meta={copy.progress}>
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
          action={stepLink("contact", `/shop/${shopSlug}/settings#contact`, copy.contactAction)}
        />
        <ChecklistStep
          title={copy.profileTitle}
          body={copy.profileBody}
          done={profileDone}
          doneLabel={copy.profileDone}
          doneBadge={copy.doneBadge}
          action={stepLink("profile", `/shop/${shopSlug}/settings#profile`, copy.profileAction)}
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
          action={stepLink("units", `/shop/${shopSlug}/settings#units`, copy.unitsAction)}
        />
        <ChecklistStep
          title={copy.siteTitle}
          body={copy.siteBody}
          done={siteDone}
          doneLabel={copy.siteDone}
          doneBadge={copy.doneBadge}
          action={stepLink("site", `/shop/${shopSlug}/dive-sites/new`, copy.siteAction)}
        />
        <ChecklistStep
          title={copy.tripTitle}
          body={copy.tripBody}
          // The whole group only renders while the shop has no upcoming trip,
          // so this step is never done at render time.
          done={false}
          doneLabel={copy.tripTitle}
          doneBadge={copy.doneBadge}
          action={stepLink("trip", `/shop/${shopSlug}/schedule/board?add=1`, copy.tripAction)}
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
        <ChecklistStep
          title={copy.stripeTitle}
          body={copy.stripeBody}
          done={stripeDone}
          doneLabel={copy.stripeDone}
          doneBadge={copy.doneBadge}
          action={
            // A plain <a>, not <Link>: this route 302s to Stripe's OAuth
            // authorize URL, and Next's client-side navigation would follow
            // that redirect via fetch — a cross-origin request Stripe's CORS
            // policy rejects. A full navigation handles the redirect natively.
            <a
              href={`/shop/${shopSlug}/settings/connect`}
              className={buttonClass({ size: "sm", variant: "secondary" })}
            >
              {copy.stripeAction}
            </a>
          }
        />
      </ol>
    </LedgerGroup>
  );
}
