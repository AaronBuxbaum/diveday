import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/StatusMark";
import { readinessStatusTone } from "@/i18n/readiness-labels";
import type { OfflineTripControls } from "./controls";
import type { OfflineTripView } from "./trip-view";

/**
 * **The desk, with no signal** (ADR 20260907-the-counter-survives-offline):
 * each seat's arrival tap, working seats first. Empty once the boat has gone.
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
      className={sectionCardClass({ className: "mt-6" })}
      aria-labelledby="offline-counter-heading"
    >
      <h2 id="offline-counter-heading" className="text-base font-semibold text-ink">
        {t("shared.offlineManifest.single.counter.heading")}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
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
            <p className="mt-1 text-sm font-medium text-danger">
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
          if (diver.readiness.status !== "ready" || diver.notHere) {
            return (
              <li
                key={diver.bookingId}
                // `px-6`, the `boat` rows' own inset beside it, so the
                // name starts where their marks do.
                className="rounded-lg border border-border bg-surface-sunken px-6 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-ink">{diver.fullName}</p>
                  {/* **The qualifier the rows below already wear.** These
                      blockers were true when the copy was saved and this
                      page cannot know whether they still are: Priya may
                      have signed at 07:20 against a copy saved at 06:50,
                      and a bare "Waiver has not been sent" sends her back
                      to sign a second time. "A stale copy reading as
                      current" is the one lie a roll-call surface must not
                      tell (docs/product/glossary.md), and the counter on
                      the same screen does not get an exemption from it.
                      The released seat's own badge carries the same
                      qualifier for the same reason: `undoBookingNoShow`
                      may have put them back on the list at 07:20. */}
                  {diver.readiness.status !== "ready" ? (
                    <Badge tone={readinessStatusTone("blocked")}>
                      {t("shared.offlineManifest.single.blockedBadge")}
                    </Badge>
                  ) : null}
                  {diver.notHere ? (
                    <Badge tone="neutral">{t("shared.offlineManifest.single.notHereBadge")}</Badge>
                  ) : null}
                </div>
                {/* Nothing where there are no blockers: a released seat
                      that readiness was clearing has the badge and the
                      missing control, and a shop's own words are the only
                      thing this line ever carries. */}
                {diver.readiness.blockers.length > 0 ? (
                  <p className="mt-1 text-sm text-muted">
                    {diver.readiness.blockers.map((blocker) => blocker.text).join(" · ")}
                  </p>
                ) : null}
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
                className={buttonClass({
                  variant: arrived ? "primary" : "secondary",
                  size: "boat",
                  // Settled rows sink and dim: the dock copy has no
                  // roster groups to file them under.
                  className: `w-full justify-between gap-3 text-start${settled ? " opacity-70" : ""}`,
                })}
              >
                <StatusMark variant={arrived ? "checked" : "unchecked"} size="md" />
                <span className="min-w-0 flex-1 truncate">{diver.fullName}</span>
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
                <span className="shrink-0 text-base font-semibold whitespace-nowrap">
                  {/* **Whose statement is this?** A tap this device made
                        is this device's own and says so plainly, with roll
                        call's "waiting to send" suffix while it is
                        unsent. A reading that came off `snapshot.checkedIn`
                        is the saved copy talking, and wears the same "when
                        saved" hedge every readiness badge on this page
                        wears — somebody may have undone it at the desk
                        since. */}
                  {!arrived
                    ? t("shared.offlineManifest.single.counter.notCheckedInLabel")
                    : arrival.local
                      ? `${t("shared.offlineManifest.single.counter.checkedInLabel")}${
                          arrival.pending
                            ? ` ${t("shared.offlineManifest.single.statePendingSuffix")}`
                            : ""
                        }`
                      : t("shared.offlineManifest.single.counter.checkedInWhenSavedLabel")}
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
