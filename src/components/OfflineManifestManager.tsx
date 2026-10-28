"use client";

import type { ReactNode } from "react";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { OfflineFreshnessPill } from "@/components/OfflineFreshnessPill";
import { buttonClass } from "@/components/ui/button";
import { cardSummaryClass, sectionCardClass } from "@/components/ui/card";
import { SummaryCaret } from "@/components/ui/disclosure";
import { GroupLabel } from "@/components/ui/group-label";
import { fill, pluralForm } from "@/i18n/fill";
import { scopedId } from "@/lib/element-id";
import { formatDateTimeTz } from "@/lib/format";
import { type OfflineManifestPayload, offlineManifestFreshness } from "@/lib/offline-manifests";
import { type OfflineManifestSyncCopy, useOfflineManifestSync } from "./use-offline-manifest-sync";

/** Every word `OfflineManifestManager` renders, resolved server-side. */
export interface OfflineManifestManagerCopy extends OfflineManifestSyncCopy {
  reconcileRejectedOne: string;
  /** `{count}` placeholder. */
  reconcileRejectedOther: string;
  heading: string;
  body: string;
  connectivityOfflineWithCopy: string;
  connectivityOffline: string;
  connectivityOnline: string;
  connectivityOnlineTitle: string;
  connectivityOfflineTitle: string;
  freshnessCurrent: string;
  freshnessAging: string;
  freshnessStale: string;
  /** `{date}`, `{pending}`, `{rejected}` placeholders. */
  savedSummary: string;
  refreshingLabel: string;
  refreshNowLabel: string;
  openOfflineRollCall: string;
  /**
   * The heading of the whole "On this phone" group this component now *is* —
   * the disclosure it renders holds every per-device concern, not only the
   * offline copy. See the render below.
   */
  groupHeading: string;
}

/**
 * The "On this phone" card. It carries `data-offline-copy="settled"` once the
 * mount's first save (or the offline read standing in for it) has finished, so
 * the freshness pill is as it will stay: the visual suite shot the pill missing
 * on one run and present on the next until it waited for that (#2509).
 */
export function OfflineManifestManager({
  payload,
  locale,
  copy,
  idPrefix,
  children,
}: {
  payload: OfflineManifestPayload;
  /** Set when a document repeats this block per departure — see `scopedId`. */
  idPrefix?: string;
  /** Negotiated request locale (see requestLocale) — never hard-coded, per AGENTS.md. */
  locale: string;
  copy: OfflineManifestManagerCopy;
  /**
   * The rest of the "On this phone" group — the push opt-in and the device
   * toggles — rendered inside this component's disclosure.
   *
   * They are passed in rather than imported because they are per-*surface*
   * concerns this component has no business knowing about, while the
   * disclosure itself has to live here: the summary line carries the live
   * connectivity and freshness state, and that state has exactly one owner.
   * Handing the collapse to the page instead would mean a second reader of the
   * offline store, which is the drift that gave the offline view its own wrong
   * copy of the row tones once already.
   */
  children?: ReactNode;
}) {
  const { tripId, saved, message, busy, settled, refresh } = useOfflineManifestSync(payload, copy);

  const pending = saved?.events.filter((event) => event.syncStatus === "pending").length ?? 0;
  const rejected = saved?.events.filter((event) => event.syncStatus === "rejected").length ?? 0;
  const cutoffNoteDiscarded = saved?.events.some(
    (event) => event.noteDisposition === "discarded_erasure_cutoff",
  );
  const unverifiedNoteDiscarded = saved?.events.some(
    (event) => event.noteDisposition === "discarded_unverified_snapshot",
  );
  const freshness = saved ? offlineManifestFreshness(new Date(saved.snapshot.savedAt)) : null;
  const freshnessLabel =
    freshness === "current"
      ? copy.freshnessCurrent
      : freshness === "aging"
        ? copy.freshnessAging
        : copy.freshnessStale;

  // A rejected event is a tap a crew member made that **never entered the
  // safety trail** — somebody stood on a deck, said "aboard", saw it stick, and
  // the server refused it when signal came back. Left in this card at the foot
  // of the page it is a sentence nobody scrolls to, on the one page where an
  // unrecorded roll call is the whole failure mode. So it is lifted out of the
  // card and pinned over the page instead, in danger tone with an `alert` role,
  // while pending/caught-up/saving stay in the card below where they belong.
  const rejectedNotice =
    rejected > 0
      ? fill(
          pluralForm(rejected, {
            one: copy.reconcileRejectedOne,
            other: copy.reconcileRejectedOther,
          }),
          { count: rejected },
        )
      : null;

  return (
    <>
      {rejectedNotice ? (
        /* Pinned just under the chrome bar, whose height it reads rather than
           measures (`--chrome-h`, ADR 20260827-clearwater-surface-language,
           decision 10). This was `top-20`, a number taken off the old 69px
           staff bar; the breathing room that number smuggled in is `pt-3` now,
           where it is a spacing decision rather than a stale measurement. */
        <div
          data-offline-rejected-notice="true"
          className="pointer-events-none fixed inset-x-0 top-(--chrome-h) z-40 flex justify-center px-4 pt-3 print:hidden"
        >
          <div
            role="alert"
            className="pointer-events-auto max-w-2xl rounded-inset border border-danger/30 bg-danger-tint px-4 py-3 text-base font-semibold text-danger shadow-lg backdrop-blur"
          >
            {rejectedNotice}
          </div>
        </div>
      ) : null}
      {/* **The whole "On this phone" group, as one line at rest** (ADR
          20260827-the-departure-is-two-working-surfaces, decision 2: device settings and offline
          detail are "ashore, not here"). Everything this *device* does — hold an offline copy, wake
          itself for a refresh, buzz — is one per-phone concern rather than anything about this
          departure, and at full height it spent the foot of every manifest on preferences nobody
          changes twice.

          **The state is not what collapses.** A stale copy that looks current is the failure mode
          this whole mechanism exists to prevent (docs/design/principles.md), so the connectivity
          chip and the freshness pill ride the *summary* — readable without a tap, exactly as
          before. What went behind the tap is the prose, the two buttons and the toggles. That is
          also why this component owns the disclosure rather than the page wrapping it in one: the
          line that must stay visible is computed here, and there is one reader of the store.

          Still a backstop rather than the way in: the shop-wide auto-prime already saves the
          near-term board on any /shop page visit (ADR 20260726-shopwide-offline-manifest-priming),
          and once a boat is truly out of signal this live page does not load at all —
          /offline-manifest is what a captain opens. */}
      <section
        data-offline-copy={settled || !tripId ? "settled" : "pending"}
        className={sectionCardClass({ padding: "none", className: "print:hidden" })}
        aria-labelledby={scopedId(idPrefix, "offline-heading")}
      >
        <details className="group/phone">
          {/* The card's face (`cardSummaryClass`): flush in a card that does
              not clip, so its fill and ring carry the card's inner corner
              wherever it touches the card — all four while closed, the top
              two once open. Its first line is the 36px row of status chips,
              so the caret's box is that tall, and so is the label's, which
              keeps the caret on the label when the chips wrap under it. */}
          <summary className={cardSummaryClass({ className: "group/summary min-h-14 px-4 py-3" })}>
            <SummaryCaret line="h-9" className="group-open/phone:rotate-90" />
            {/* A deliberate eyebrow rather than a section heading, which is a
                scale `SectionCard`'s own `title` does not render. */}
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              <GroupLabel
                as="h2"
                id={scopedId(idPrefix, "offline-heading")}
                className="flex min-h-9 items-center group-hover/summary:underline"
              >
                {copy.groupHeading}
              </GroupLabel>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <ConnectivityStatus
                  offlineLabel={saved ? copy.connectivityOfflineWithCopy : copy.connectivityOffline}
                  copy={{
                    online: copy.connectivityOnline,
                    onlineTitle: copy.connectivityOnlineTitle,
                    offlineTitle: copy.connectivityOfflineTitle,
                  }}
                />
                {freshness ? (
                  <OfflineFreshnessPill freshness={freshness}>
                    {freshnessLabel}
                  </OfflineFreshnessPill>
                ) : null}
              </span>
            </span>
          </summary>
          <div className="space-y-5 px-4 pb-4 pt-3">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,auto)] sm:items-start">
              <div className="min-w-0 max-w-2xl">
                <h3 className="font-semibold">{copy.heading}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{copy.body}</p>
                {/* The live region stays mounted whether or not it currently has
                    anything to say, so an announcement is heard when one
                    arrives. */}
                <p className={message ? "mt-2 text-sm font-medium" : ""} aria-live="polite">
                  {message}
                </p>
                {cutoffNoteDiscarded ? (
                  <p className="mt-2 text-sm text-muted" role="status">
                    {copy.reconcileNoteDiscarded}
                  </p>
                ) : null}
                {unverifiedNoteDiscarded ? (
                  <p className="mt-2 text-sm text-muted" role="status">
                    {copy.reconcileNoteUnverified}
                  </p>
                ) : null}
                {saved ? (
                  <p className="mt-1 text-xs text-muted">
                    {fill(copy.savedSummary, {
                      date: formatDateTimeTz(
                        new Date(saved.snapshot.savedAt),
                        locale,
                        payload.shop.timezone,
                      ),
                      pending: String(pending),
                      rejected: String(rejected),
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-3 sm:min-w-52">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => refresh({ manual: true })}
                  className={buttonClass({
                    variant: "secondary",
                    size: "boat",
                    className: "w-full",
                  })}
                >
                  {busy ? copy.refreshingLabel : copy.refreshNowLabel}
                </button>
                {saved ? (
                  // `secondary`, deliberately: this is the standby door to the
                  // fallback viewer, on a panel whose chips already say the copy
                  // maintains itself — as `primary` it was the strongest control
                  // on the whole manifest, outshouting the roll call above it
                  // (principle 8; design review 2026-08-21). Still boat-sized:
                  // the moment it is needed is the moment of wet hands.
                  <a
                    href={`/offline-manifest?trip=${tripId}`}
                    className={buttonClass({
                      variant: "secondary",
                      size: "boat",
                      className: "w-full",
                    })}
                  >
                    {copy.openOfflineRollCall}
                  </a>
                ) : null}
              </div>
            </div>
            {/* `empty:hidden` because the rows the surface passes in render
                *nothing* under ordinary conditions — the push opt-in while it is
                still checking the device and on any deployment with no VAPID
                keys, the haptics switch on a phone that cannot vibrate — and a separator above nothing is a rule
                across an empty band. */}
            <div className="border-t border-border pt-5 empty:hidden">{children}</div>
          </div>
        </details>
      </section>
    </>
  );
}
