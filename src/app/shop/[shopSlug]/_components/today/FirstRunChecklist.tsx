"use client";

import Link from "next/link";
import { Copyable } from "@/components/Copyable";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";

export type FirstRunChecklistCopy = {
  heading: string;
  subtitle: string;
  contactTitle: string;
  contactBody: string;
  contactAction: string;
  contactDone: string;
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
  action: React.ReactNode;
}) {
  return (
    // These are compact steps inside the primary-toned onboarding panel, not
    // page sections. They stay inset and retain their tighter radius so the
    // checklist reads as one guided object rather than nested full cards.
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? // `-tint`, not `/15`: this tick renders on the shop home, in the
                // app palette, where `-strong` on a 15% fill measures 4.33:1
                // over `--background` (issue #874). The opaque token is 4.86:1
                // wherever it is mounted, which is the whole argument for it.
                "bg-success-tint text-success-strong"
              : "border-2 border-dashed border-border-strong"
          }`}
        >
          {done ? "✓" : ""}
        </span>
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 text-sm text-muted">{done ? doneLabel : body}</p>
        </div>
      </div>
      {done ? (
        <Badge tone="success" size="sm" className="shrink-0 self-start sm:self-center">
          {doneBadge}
        </Badge>
      ) : (
        <div className="shrink-0 self-start sm:self-center">{action}</div>
      )}
    </li>
  );
}

function CopyScheduleLinkButton({
  url,
  copy,
  copied,
  failed,
}: {
  url: string;
  copy: string;
  copied: string;
  failed: string;
}) {
  return (
    <Copyable
      layout="inline"
      value={url}
      copyLabel={copy}
      copiedLabel={copied}
      failedLabel={failed}
    />
  );
}

/**
 * A new, real shop's Today is otherwise an empty work queue — nothing to
 * crew, nothing to check divers into. This replaces that blank landing with
 * the five things that actually get a shop from "just signed up" to "divers
 * can book": contact details, a dive site, a trip, the link that sells it,
 * and (optional) taking payment online. Each step's done-state comes from a
 * real query, never a dismiss-and-forget flag, so it reflects the shop's
 * actual progress on every visit.
 */
export function FirstRunChecklist({
  shopSlug,
  scheduleUrl,
  contactDone,
  diveSiteCount,
  unitsDone,
  stripeDone,
  copy,
}: {
  shopSlug: string;
  scheduleUrl: string;
  contactDone: boolean;
  diveSiteCount: number;
  /** The shop has saved its units at least once — see the step below. */
  unitsDone: boolean;
  stripeDone: boolean;
  copy: FirstRunChecklistCopy;
}) {
  return (
    <section
      aria-labelledby="first-run-heading"
      className="mb-10 rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:p-6"
    >
      <h2 id="first-run-heading" className="text-lg font-semibold">
        {copy.heading}
      </h2>
      <p className="mt-1 text-sm text-muted">{copy.subtitle}</p>

      <ol className="mt-4 flex flex-col gap-2.5">
        <ChecklistStep
          title={copy.contactTitle}
          body={copy.contactBody}
          done={contactDone}
          doneLabel={copy.contactDone}
          doneBadge={copy.doneBadge}
          action={
            // Straight to the open contact row — the settings hub keeps its
            // forms behind summary rows, and a link that promises a form must
            // land on it open.
            <Link
              href={`/shop/${shopSlug}/settings#contact`}
              className={buttonClass({ size: "sm" })}
            >
              {copy.contactAction}
            </Link>
          }
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
          action={
            <Link href={`/shop/${shopSlug}/settings#units`} className={buttonClass({ size: "sm" })}>
              {copy.unitsAction}
            </Link>
          }
        />
        <ChecklistStep
          title={copy.siteTitle}
          body={copy.siteBody}
          done={diveSiteCount > 0}
          doneLabel={copy.siteDone}
          doneBadge={copy.doneBadge}
          action={
            <Link href={`/shop/${shopSlug}/dive-sites/new`} className={buttonClass({ size: "sm" })}>
              {copy.siteAction}
            </Link>
          }
        />
        <ChecklistStep
          title={copy.tripTitle}
          body={copy.tripBody}
          // The whole checklist only renders while the shop has no upcoming
          // trip, so this step is never done at render time — no separate
          // query needed to know that.
          done={false}
          doneLabel={copy.tripTitle}
          doneBadge={copy.doneBadge}
          action={
            <Link
              href={`/shop/${shopSlug}/schedule/board?add=1`}
              className={buttonClass({ size: "sm" })}
            >
              {copy.tripAction}
            </Link>
          }
        />
        <li className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          {/* `min-w-0` on both levels, or the `truncate` below never fires: a
              flex item defaults to `min-width:auto`, so these boxes grow to
              their widest child — the URL — and push the whole page wider than
              the viewport instead of clipping it. Only visible once the URL is
              absolute (a configured APP_HOST); with no origin it degrades to a
              short path and fits by accident. */}
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border-strong text-xs font-bold"
            />
            <div className="min-w-0">
              <p className="font-medium">{copy.scheduleTitle}</p>
              <p className="mt-0.5 text-sm text-muted">{copy.scheduleBody}</p>
              <p className="mt-2 max-w-full truncate font-mono text-xs text-muted">{scheduleUrl}</p>
            </div>
          </div>
          <div className="shrink-0 self-start sm:self-center">
            <CopyScheduleLinkButton
              url={scheduleUrl}
              copy={copy.scheduleCopy}
              copied={copy.scheduleCopied}
              failed={copy.scheduleCopyFailed}
            />
          </div>
        </li>
        <ChecklistStep
          title={copy.stripeTitle}
          body={copy.stripeBody}
          done={stripeDone}
          doneLabel={copy.stripeDone}
          doneBadge={copy.doneBadge}
          action={
            // A plain <a>, not <Link>: this route 302s to Stripe's OAuth
            // authorize URL, and Next's client-side navigation would follow
            // that redirect via fetch — a cross-origin request Stripe's
            // CORS policy rejects. A full navigation handles the redirect
            // natively.
            <a
              href={`/shop/${shopSlug}/settings/connect`}
              className={buttonClass({ size: "sm", variant: "secondary" })}
            >
              {copy.stripeAction}
            </a>
          }
        />
      </ol>
    </section>
  );
}
