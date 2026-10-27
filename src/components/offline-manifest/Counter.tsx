import { sectionCardClass } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/StatusMark";
import { offlineTrainingReadinessStale } from "@/lib/offline-manifests";
import type { OfflineTripControls } from "./controls";
import type { OfflineTripView } from "./trip-view";

/**
 * **The desk, with no signal** (ADR 20260907-the-counter-survives-offline):
 * each seat's arrival tap, working seats first. Empty once the boat has gone.
 *
 * **One row shape on one surface** (visual review 2026-10-24, B01): a mark, the
 * name, and one status line under it, every row the same flat row under one
 * divider. A seat the desk cannot take a tap on says why on that line, in
 * danger ink when readiness stops it; nothing else about the row changes. The
 * page's banner says once that this is a saved copy, so no line says "when
 * saved".
 */
export function OfflineCounter({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { counterSeats, expired } = view;
  const { t, busyArrival, recordArrival } = controls;
  return counterSeats.length > 0 ? (
    <section
      className={sectionCardClass({ padding: "none", className: "mt-6" })}
      aria-labelledby="offline-counter-heading"
    >
      <h2 id="offline-counter-heading" className="px-4 py-4 text-base font-semibold text-ink">
        {t("shared.offlineManifest.single.counter.heading")}
      </h2>
      <ul className="divide-y divide-border border-t border-border">
        {counterSeats.map(({ diver, arrival, refused, settled }) => {
          const arrived = arrival !== undefined;
          const busy = busyArrival === diver.bookingId;
          // **Why the row went back**, when the server refused this
          // seat's newest tap. Without it a settled-then-reverted row is
          // indistinguishable from a tap the tablet never registered, and
          // the staffer taps again instead of looking at the blocker
          // (`refusedOfflineArrival`, and the ADR's own paragraph).
          //
          // **`not_bookable` is two events wearing one code, and the
          // sentence says both** (#1705). `checkInBooking` returns it
          // for a cancelled seat *and* for one the desk released, and
          // the branch above cannot pre-empt the second: a copy saved at
          // 07:05 carries `notHere: false` for a diver written off at
          // 07:20, so the tap was offered, made, and refused. Naming
          // only the cancellation told a crew member a story about their
          // own booking that never happened. Splitting the code would
          // have to reach through `checkInBooking`, the sync route and
          // the queued event's `rejectionReason`; the honest sentence
          // costs nothing and says the same thing either way, which is:
          // this seat is not yours to check in, read the live counter.
          const refusal = refused ? (
            <p className="px-4 pb-3 ps-12 text-sm font-medium text-danger">
              {t(
                refused.reason === "not_ready"
                  ? "shared.offlineManifest.single.counter.refusedNotReady"
                  : refused.reason === "not_bookable"
                    ? "shared.offlineManifest.single.counter.refusedNotBookable"
                    : refused.reason === "boarded"
                      ? "shared.offlineManifest.single.counter.refusedBoarded"
                      : "shared.offlineManifest.single.counter.refusedGeneric",
              )}
            </p>
          ) : null;
          // **No tap on a seat the desk cannot take one on**, which is
          // the live counter's own grammar: such a row shows what is in
          // the way instead of a control (the Divers tab's desk). Offering
          // one here would offer a tap the server refuses the moment it
          // lands. Two seats qualify, for two different reasons, and
          // each says which in a badge rather than in a sentence.
          //
          // **Readiness refuses them.** `checkInBooking` re-reads
          // readiness live and answers `not_ready`. The blocker
          // sentences were resolved into this copy when it was saved, so
          // they are already in the reader's language.
          //
          // **The desk released the seat** (#1209, #1705). The booking's
          // `status` column reads `no_show`, so the same call answers
          // `not_bookable`, and the row that came back wore "this
          // booking was cancelled" — a sentence about a thing nobody
          // did. Only the *desk's* control goes: the roll call below
          // still boards a body the crew can see, and the rail takes the
          // released seat back on sync rather than turning that body
          // away.
          const staleTrainingReadiness = offlineTrainingReadinessStale(
            view.envelope.snapshot,
            diver,
          );
          if (diver.readiness.status !== "ready" || diver.notHere || staleTrainingReadiness) {
            const blocked = diver.readiness.status !== "ready" || staleTrainingReadiness;
            // The status line: why the desk cannot tap. Readiness's own
            // reasons, resolved into this copy when it was saved, so already
            // in the reader's language; then the desk's release, when there
            // is one. A blocked seat with no reason saved says "Blocked".
            const why = [
              ...(staleTrainingReadiness ? [t("manifest.trainingReadinessStale")] : []),
              ...(blocked ? diver.readiness.blockers.map((blocker) => blocker.text) : []),
              ...(blocked && !staleTrainingReadiness && diver.readiness.blockers.length === 0
                ? [t("shared.offlineManifest.single.blockedBadge")]
                : []),
              ...(diver.notHere
                ? [
                    diver.turnedAway
                      ? t("shared.offlineManifest.single.turnedAwayBadge")
                      : t("shared.offlineManifest.single.notHereBadge"),
                  ]
                : []),
            ].join(" · ");
            return (
              <li key={diver.bookingId}>
                <div className="flex min-h-14 items-start gap-3 px-4 py-3">
                  {/* The mark's room, empty: no tap here, and the name starts
                      where every tappable row's does. */}
                  <span aria-hidden="true" className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1 break-words">
                    <span className="block text-base font-semibold text-ink">{diver.fullName}</span>
                    <span
                      className={`mt-1 block text-base ${blocked ? "font-semibold text-danger" : "text-muted"}`}
                    >
                      {why}
                    </span>
                  </span>
                </div>
                {refusal}
              </li>
            );
          }
          return (
            <li key={diver.bookingId}>
              <button
                type="button"
                disabled={busy || expired}
                aria-busy={busy}
                aria-pressed={arrived}
                onClick={() => recordArrival(diver.bookingId, arrived ? "cleared" : "arrived")}
                // The flat row (B01). Settled rows dim: the dock copy has no
                // roster groups to file them under.
                className={`flex min-h-14 w-full touch-manipulation items-start gap-3 px-4 py-3 text-start hover:bg-surface-sunken disabled:opacity-60${settled ? " opacity-70" : ""}`}
              >
                <StatusMark variant={arrived ? "checked" : "unchecked"} size="md" />
                <span className="min-w-0 flex-1 whitespace-normal break-words">
                  <span className="block text-base font-semibold text-ink">{diver.fullName}</span>{" "}
                  {/* **The act, in words, on the row.** A name beside a
                      circle is what every roll-call row on this page also
                      is, and the one thing a crew member must never do
                      here is board somebody by reaching for the wrong
                      list. So the control says which question it answers,
                      in the live counter's own two words. */}
                  {/* `text-base`, matching the live counter's own trailing
                      word rather than shrinking it: this is a wet-thumb
                      surface in sun, and 14px on it is the size the
                      critical-text rule exists about. */}
                  <span className="mt-1 block text-base">
                    {/* **Whose statement is this?** A tap this device made
                        and has not sent yet carries roll call's "waiting
                        to send" suffix. A reading off `snapshot.checkedIn`
                        is the saved copy talking, which the page's banner
                        says once ("Saved copy from …"), so the line no
                        longer repeats "when saved" (B01). */}
                    {!arrived
                      ? t("shared.offlineManifest.single.counter.notCheckedInLabel")
                      : `${t("shared.offlineManifest.single.counter.checkedInLabel")}${
                          arrival.local && arrival.pending
                            ? ` ${t("shared.offlineManifest.single.statePendingSuffix")}`
                            : ""
                        }`}
                  </span>
                </span>
              </button>
              {refusal}
            </li>
          );
        })}
      </ul>
    </section>
  ) : null;
}
