import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import type { RollCallRowState } from "@/lib/manifests";
import type { OfflineRollCallResult } from "@/lib/offline-manifests";
import type { OfflineTripControls } from "./controls";
import {
  OFFLINE_BOAT_TARGET_CLASS,
  OFFLINE_DISCLOSURE_SUMMARY_CLASS,
  OfflineRollCallNote,
  OfflineStatusLabel,
  reTap,
} from "./shared";

/**
 * **The exception, a deliberate second step away** (#1840). "Not boarded" at
 * the dock, "not back aboard" after a dive, and both ways back out of a stated
 * "not back aboard", behind a disclosure on the person's row — never on the
 * row itself.
 *
 * This is ADR 20260827-the-departure-is-two-working-surfaces, decision 3, on
 * the copy a crew works when the signal drops: *a destructive roll-call claim
 * is never a single tap*. The two used to sit side by side under every name
 * here, so "Mark not back aboard" was one tap from the list — the
 * highest-consequence claim this app can make, a thumb-width from the
 * ordinary one. The live manifest moved it into the person's panel; this is
 * the same move, so the row at rest carries one circle and nothing else
 * (`RollCallMarkTap`), exactly as it does there.
 *
 * Both directions out of a missing person cost the same two gestures — open
 * this, then either "Confirm … is aboard" or a re-tap of "Not back aboard"
 * that retracts it — because retracting a mark may never be harder than
 * making one (ADR 20260815-offline-can-unsay-a-missing-diver).
 *
 * **No danger ink until somebody records something** (decision 4): the
 * unrecorded control is a plain bordered one after a dive too, as on the live
 * page. The recorded states keep their words — a checked "Not boarded" at the
 * dock, a danger "Not back aboard" with a cross after a dive (DOM-H3).
 *
 * Keyed on the checkpoint by its caller's `key`, so an opened panel closes
 * when the crew moves to the next count rather than standing open over a
 * different question.
 */
export function OfflineRollCallException({
  subject,
  subjectKey,
  name,
  state,
  rowState,
  isDeparture,
  isCrew,
  controls,
}: {
  subject: { bookingId: string } | { crewPersonId: string };
  /** The booking or person id: what `busyBooking` and the note drafts are keyed on. */
  subjectKey: string;
  name: string;
  state: OfflineRollCallResult | undefined;
  rowState: RollCallRowState;
  isDeparture: boolean;
  isCrew: boolean;
  controls: Pick<
    OfflineTripControls,
    "t" | "busyBooking" | "noteDrafts" | "setNoteDrafts" | "record"
  >;
}) {
  const { t, busyBooking, noteDrafts, setNoteDrafts, record } = controls;
  const busy = busyBooking === subjectKey;
  const { recordedNotBoarded, notBackAboard: missing, recordedHere } = rowState;
  return (
    <details data-roll-call-exception className="group/offlineexception mt-2 max-w-xl print:hidden">
      <summary className={OFFLINE_DISCLOSURE_SUMMARY_CLASS}>
        <DisclosureCaret className="group-open/offlineexception:rotate-90" />
        <span className="group-hover/summary:underline">
          {recordedNotBoarded
            ? t("shared.offlineManifest.single.exceptionSummaryRecorded")
            : isDeparture
              ? t("shared.offlineManifest.single.exceptionSummaryDeparture")
              : t("shared.offlineManifest.single.exceptionSummaryAfterDive")}
        </span>
      </summary>
      <div className="mb-1 grid gap-3 rounded-inset border border-border/70 bg-surface-sunken/50 p-3 text-base font-normal text-foreground">
        {/* The sentence for the alarm about to be raised: after a dive,
          while nothing is recorded. Never at the dock, where "not boarded"
          means "never left". Once the alarm stands, the box moves to the
          sighting below — the positive act worth describing. */}
        {isDeparture || state !== undefined ? null : (
          <OfflineRollCallNote
            subjectId={subjectKey}
            label={t("manifest.rollCallNoteLabel")}
            value={noteDrafts[subjectKey] ?? ""}
            onChange={(next) => setNoteDrafts((drafts) => ({ ...drafts, [subjectKey]: next }))}
          />
        )}
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() =>
            record(
              subject,
              // A re-tap is the undo, as on the live manifest: it queues a
              // **retraction** naming the statement it takes back, and
              // only over a statement **this device** queued
              // (`state.local`). Aiming one at a snapshot result could take
              // another crew member's missing-diver mark off the boat on the
              // strength of an old copy (security review, 2026-08-15; ADR
              // 20260815-an-offline-retraction-names-its-target).
              reTap(state, recordedNotBoarded, "not_boarded"),
              state,
            )
          }
          // Only the dock's settled state gets the undo-bearing name. After a
          // dive "not back aboard" carries its own visible undo sentence
          // below, and saying it here as well would say it twice.
          aria-label={
            recordedNotBoarded && isDeparture
              ? isCrew
                ? t("manifest.crewNotAboardCheckAriaLabel")
                : t("manifest.notBoardedCheckAriaLabel")
              : undefined
          }
          className={`${OFFLINE_BOAT_TARGET_CLASS} ${
            missing
              ? "border border-danger bg-danger-tint text-danger"
              : recordedNotBoarded
                ? "border border-border-strong bg-surface-sunken"
                : "border border-border-strong bg-surface hover:bg-surface-sunken"
          }`}
        >
          {busy ? (
            t("shared.offlineManifest.single.saving")
          ) : recordedNotBoarded ? (
            isDeparture ? (
              <OfflineStatusLabel variant="checked">
                {isCrew
                  ? t("manifest.crewNotAboardCheck")
                  : t("shared.offlineManifest.single.notBoardedDone")}
              </OfflineStatusLabel>
            ) : (
              <OfflineStatusLabel variant="danger">
                {isCrew
                  ? t("manifest.crewNotBackAboardActive")
                  : t("shared.offlineManifest.single.notBackAboardActive")}
              </OfflineStatusLabel>
            )
          ) : isDeparture ? (
            isCrew ? (
              t("manifest.crewMarkNotAboard")
            ) : (
              t("shared.offlineManifest.single.markNotBoarded")
            )
          ) : isCrew ? (
            t("manifest.crewMarkNotBackAboard")
          ) : (
            t("shared.offlineManifest.single.markNotBackAboard")
          )}
        </button>
        {/* The loudest mark on the page states how it comes back off, or
          that it cannot from here: a mark another device made is undone
          where it was made. */}
        {recordedHere && missing ? (
          <p className="text-sm text-muted">
            {state?.local
              ? t("manifest.tapToUndoNotBackAboard")
              : t("shared.offlineManifest.single.markedElsewhere")}
          </p>
        ) : null}
        {/* **The sighting, apart from the retraction** (review of #1840).
          Both take a missing mark off, and they say opposite things: the
          retraction above says "nobody should have said it", this says "I
          can see them aboard". A slip from one onto the other must never
          write a sighting nobody made, so this is not the next button down:
          it comes second, below a rule, in a group of its own, with the
          sentence that describes it. */}
        {missing ? (
          <div data-roll-call-sighting className="mt-2 grid gap-3 border-t border-border pt-4">
            {isDeparture ? null : (
              <OfflineRollCallNote
                subjectId={subjectKey}
                label={t("manifest.rollCallNoteLabel")}
                value={noteDrafts[subjectKey] ?? ""}
                onChange={(next) => setNoteDrafts((drafts) => ({ ...drafts, [subjectKey]: next }))}
              />
            )}
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              // A positive sighting, never a retraction: "I have eyes on
              // her, she's aboard", named on the control so it cannot be
              // read as a generic "Confirm".
              onClick={() => record(subject, { status: "boarded" }, state)}
              className={`${OFFLINE_BOAT_TARGET_CLASS} border border-success bg-success-tint text-success-strong`}
            >
              {busy
                ? t("shared.offlineManifest.single.saving")
                : t("shared.offlineManifest.single.confirmAboard", { name })}
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
