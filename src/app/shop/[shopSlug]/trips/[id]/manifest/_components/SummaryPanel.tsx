import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { readinessStatusText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";

/**
 * The sticky progress panel: which checkpoint is live, how much of it is
 * recorded, the counts behind that fraction, and the one line that says
 * whether it is closed.
 *
 * This is the page's **only** count surface. It used to share the job with a
 * six-tile grid above the checkpoint nav (three responsive layouts of the same
 * numbers) and a standalone "Blocked divers" banner below it, which put three
 * restatements of one head count between the captain and the first diver row.
 * The tiles are gone and the blocked banner is the quiet sentence below.
 *
 * **What sticks and what scrolls.** Only the top half is pinned: the heading,
 * the bar, the count row, and every DANGER line (someone not back aboard, crew
 * not back aboard, a split team). The muted prose — "2 divers still to call",
 * the blocked sentence — renders immediately below in the same visual
 * language but scrolls away, so a phone keeps diver rows on screen instead of
 * giving a third of the viewport to a sentence that repeats the number above
 * it. Nothing that says a person is unaccounted for is allowed to scroll off.
 *
 * **Both halves are returned as siblings, not wrapped in one `<section>`.** A
 * `position: sticky` element is pinned only while its own containing block is
 * on screen, and a wrapper around just these two blocks is barely taller than
 * the card itself — so the panel used to unstick and scroll away the moment
 * the first few diver rows went past, which is the opposite of what a captain
 * working down a roster needs. Returned flat, the containing block is the
 * page's own column, and the card stays pinned for the whole roll call. Keep
 * it that way: re-introducing a wrapper here silently un-pins the panel again.
 */
export function SummaryPanel({
  checkpoint,
  isDeparture,
  rollCallComplete,
  completeness,
  summary,
  separatedTeams,
  uncalled,
  t,
}: {
  checkpoint: RollCallCheckpoint;
  /**
   * "Not boarded" is the dock's word for *never left*; after a dive the same
   * number means "not back aboard" (DOM-H3, `isNotBackAboard` in
   * src/lib/manifests.ts). The page resolves which checkpoint this is — the
   * count row and the blocked sentence both follow it, so no surface can put a
   * dock word beside a diver who is unaccounted for in the water.
   */
  isDeparture: boolean;
  rollCallComplete: boolean;
  completeness: TripManifest["completeness"];
  summary: TripManifest["summary"];
  /**
   * A count of split *teams*, not of rows wearing an alert (`splitBuddyTeamIds`,
   * src/lib/manifests.ts) — the page derives it, this only says it.
   */
  separatedTeams: number;
  /**
   * The divers nobody has said anything about at this checkpoint — the same
   * derivation the page makes once (`uncalledDivers`). Rendered as jump chips
   * in the scrolling half, right under the count that names them: the answer
   * to "who am I still waiting on?" sits where the question arises, instead of
   * in a separate face-grid section further down the page (principle 10). Each
   * chip links to that diver's own row.
   */
  uncalled: ReadonlyArray<{ bookingId: string; fullName: string; blocked: boolean }>;
  t: StaffTranslator;
}) {
  // Who among the named crew is still unaccounted for at this checkpoint. Read
  // off the completeness verdict itself rather than recomputed, so this page
  // and the rule that closes the checkpoint can never disagree.
  const crewCounts = completeness.crewCounts;
  // Divers a human recorded as *ashore* after a dive: `notBoarded` counts every
  // `not_boarded` result, and after a dive that set splits in two —
  // `isNotBackAboard` is the explicit "did not come back", the rest is the
  // dock's "never left" carried forward. So `notBoarded − notBackAboard` is
  // exactly the settled half, and it is never negative because the missing set
  // is a subset of the not-boarded set by construction.
  const ashore = summary.notBoarded - summary.notBackAboard;
  // The head count, in words and figures. Every entry is a label plus a
  // number — never a colour-coded chip a captain has to decode in sunlight
  // (phone/sunlight invariant), and `tabular-nums` so the figures hold their
  // columns as they tick.
  //
  // **The entries are mutually exclusive and sum to `totalDivers`**, at both
  // kinds of checkpoint. Every diver has at most one roll-call result, so:
  //
  //  - at departure — `boarded` + `notBoarded` + `awaiting` covers "aboard",
  //    "a human said they're not", and "nobody has said" with nothing left
  //    over (`notBackAboard` is structurally 0 there).
  //  - after a dive — the same three, with `notBoarded` split into the stated
  //    "not back aboard" and the settled `ashore` above.
  //
  // This is why "Blocked" is not on the row: it is a readiness fact, not a
  // roll-call outcome, so it overlapped `awaiting` and made a 9-diver boat read
  // "Boarded 0 · Not boarded 0 · Awaiting 9 · Blocked 1" — ten people on a boat
  // with nine seats. The count it carried is in the blocked sentence below, in
  // words.
  const counts: Array<{ label: string; value: number }> = isDeparture
    ? [
        { label: t("manifest.summaryBoarded"), value: summary.boarded },
        { label: t("manifest.summaryNotBoarded"), value: summary.notBoarded },
        { label: t("manifest.summaryAwaiting"), value: summary.awaiting },
      ]
    : [
        { label: t("manifest.summaryBoarded"), value: summary.boarded },
        { label: t("manifest.summaryNotBackAboard"), value: summary.notBackAboard },
        // A calm, settled word for the people who never left the dock — they
        // are accounted for on land, and naming them alongside the missing
        // keeps the row honest instead of silently dropping them.
        { label: t("manifest.summaryAshore"), value: ashore },
        { label: t("manifest.summaryAwaiting"), value: summary.awaiting },
      ];
  // A stated "a crew member did not come back" must be on screen even when the
  // *top* reason is a clerical diver gap. `rollCallCompleteness` ranks
  // `divers_awaiting` above `crew_not_back_aboard` deliberately (other surfaces
  // key off that ranking and it is not this panel's to change), and this page
  // used to render `reason` alone — so a boat with a divemaster still down and
  // two divers uncalled read as a muted "2 divers still to call". The crew
  // half's own verdict (`crewReason`) is what a crew line has to follow, and it
  // is never suppressed by a diver gap. Both danger lines may show at once.
  const crewNotBackAboard = completeness.crewReason === "crew_not_back_aboard";
  const diversNotBackAboard = completeness.reason === "divers_not_back_aboard";
  // The muted half: what is still open when nothing here is an emergency. It
  // goes quiet whenever a danger line above already names the same gap.
  // `no_divers` keeps the closing sentence it has always had — an empty roster
  // is its own problem and not one this line was ever written to explain.
  const mutedText = diversNotBackAboard
    ? null
    : completeness.reason === "crew_not_back_aboard"
      ? null
      : completeness.reason === "divers_awaiting"
        ? t("manifest.stillToCall", { count: summary.awaiting })
        : completeness.reason === "crew_none_assigned"
          ? t("manifest.crewNoneAssignedYet")
          : completeness.reason === "crew_none_aboard"
            ? t("manifest.crewNoneAboard")
            : completeness.reason === "crew_awaiting"
              ? t("manifest.crewAwaiting", { count: crewCounts.crewAwaiting })
              : completeness.reason === "no_divers"
                ? // An empty roster keeps the checkpoint open (the completeness
                  // rule refuses it), and the sentence here must not read as an
                  // all-clear over a manifest that counts nobody — the same
                  // never-an-all-clear rule the glossary sets for shops that
                  // skip roll call (dive-domain review 20260810).
                  t("manifest.noDiversLine")
                : t("manifest.allAccountedFor");
  return (
    <>
      <section
        aria-labelledby="roll-call-progress-heading"
        className={
          rollCallComplete
            ? "rise-in sticky top-20 z-10 mt-4 rounded-2xl border border-accent/50 bg-accent/10 p-4 shadow-lg backdrop-blur print:hidden"
            : "sticky top-20 z-10 mt-4 rounded-2xl border border-primary/30 bg-surface/95 p-4 shadow-lg backdrop-blur print:hidden"
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
              {t("manifest.activeCheckpoint")}
            </p>
            <h2 id="roll-call-progress-heading" className="mt-1 text-lg font-bold">
              {rollCallComplete
                ? t("manifest.rollCallComplete")
                : rollCallCheckpointText(t, checkpoint)}
            </h2>
          </div>
          <p className="text-base font-bold tabular-nums">
            {t("manifest.recordedOfTotal", {
              recorded: summary.totalDivers - summary.awaiting,
              total: summary.totalDivers,
            })}
          </p>
        </div>
        <div
          className="mt-3 h-3 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-label={t("manifest.progressAriaLabel")}
          aria-valuemin={0}
          aria-valuemax={summary.totalDivers}
          aria-valuenow={summary.totalDivers - summary.awaiting}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{
              width: `${
                summary.totalDivers === 0
                  ? 0
                  : ((summary.totalDivers - summary.awaiting) / summary.totalDivers) * 100
              }%`,
            }}
          />
        </div>
        {/* The counts the six tiles used to carry, folded in under the bar they
            explain. A definition list, not a grid of cards: label/number pairs
            read in one pass and cost the roll-call list no vertical space on a
            phone. */}
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-base">
          {counts.map((count) => (
            <div key={count.label} className="flex items-baseline gap-1.5">
              <dt className="text-muted">{count.label}</dt>
              <dd className="font-bold tabular-nums">{count.value}</dd>
            </div>
          ))}
        </dl>
        {/* Everything below stays *pinned*: each of these lines says a person
            is unaccounted for, and a captain scrolling the roster must not be
            able to push that off the top of the screen. */}
        {diversNotBackAboard ? (
          <p className="mt-2 text-base font-bold text-danger" role="status">
            {t("manifest.notBackAboardOpen", { count: summary.notBackAboard })}
          </p>
        ) : null}
        {crewNotBackAboard ? (
          <p className="mt-2 text-base font-bold text-danger" role="status">
            {t("manifest.crewNotBackAboard", { count: crewCounts.crewNotBackAboard })}
          </p>
        ) : null}
        {/* Buddy teams that came back split — someone aboard, someone not
            (ADR 20260804-buddy-teams). Its own line, never folded into the
            completeness reason below: it informs the deck and blocks
            nothing, and the checkpoint's own open/closed verdict must not
            appear to depend on it. */}
        {separatedTeams > 0 ? (
          <p className="mt-2 text-base font-bold text-danger" role="status">
            {t("manifest.buddySeparatedLine", { count: separatedTeams })}
          </p>
        ) : null}
      </section>
      {/* The prose half, immediately below the pinned card and in the same
          visual language — it may scroll away. Nothing here is an emergency:
          the closing line when it is calm, and what being blocked means at
          *this* checkpoint. */}
      <div className="px-4 pt-2 print:hidden">
        {/* The line that says whether this checkpoint is closed. It used to go
            quiet at `awaiting === 0` — every diver counted, nothing said about
            the crew. Now it names what is still open. */}
        {/* Stays mounted whether or not it currently has anything to say, so a
            change is announced when one arrives. */}
        <p className="text-base font-semibold text-muted" aria-live="polite">
          {mutedText}
        </p>
        {/* Who the count is about, one tappable chip each. This replaced the
            standalone "Still to board" face-grid section: the names belong to
            the number that summarizes them, not to a second surface a captain
            reaches after scrolling the whole roster. Independent of
            `mutedText` — a stated not-back-aboard suppresses the muted count
            while divers may still be uncalled, and those names must not
            disappear with it. Words carry the exceptional state (a blocked
            diver's chip says so), never colour alone.

            Only once the roll call has *started*: "who's left?" is a
            mid-roll-call question, and at 0 recorded the chips would restate
            the entire roster immediately above the roster itself (principle
            9). The count line above covers the starting state. */}
        {uncalled.length > 0 && uncalled.length < summary.totalDivers ? (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("manifest.stillToCallListLabel")}>
            {uncalled.map((diver) => (
              <li key={diver.bookingId}>
                <a
                  href={`#diver-row-${diver.bookingId}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-base font-semibold hover:bg-surface-sunken"
                >
                  {diver.fullName}
                  {diver.blocked && isDeparture ? (
                    <span className="text-base font-medium text-danger">
                      {readinessStatusText(t, "blocked")}
                    </span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {/* What being blocked means at *this* checkpoint. This was a warning-
            toned banner of its own under the panel, with a "Blocked divers"
            heading restating the count the panel already showed. The count is
            here in words — it is deliberately not an entry on the count row,
            which sums to the boat (see `counts` above). `text-warning-strong`,
            not `text-warning`: safety text on a plain surface has to clear AA
            at this size. */}
        {summary.blocked > 0 ? (
          <p className="mt-1 text-base font-semibold text-warning-strong">
            {isDeparture
              ? t("manifest.blockedDeparture", { count: summary.blocked })
              : t("manifest.blockedAfterDive", { count: summary.blocked })}
          </p>
        ) : null}
      </div>
    </>
  );
}
