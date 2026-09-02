import { groupLabelClass } from "@/components/ui/ledger";
import { StatusMark } from "@/components/ui/StatusMark";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { readinessStatusText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";
import { HeadCount } from "./HeadCount";

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
  uncalledCrew,
  notBackAboardDivers,
  notBackAboardCrew,
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
  /**
   * The crew nobody has said anything about at this checkpoint — the same
   * derivation for the other half of the head count.
   *
   * Crew used to reach this panel only as the muted "N crew members still to
   * call" line: a number that names nobody, on the half of the boat most
   * reliably in the water (DOM-H1). The chips name them, marked "(crew)" in
   * the same words the buddy panel uses, and each links to that crew member's
   * own row — which is otherwise below every diver row on the page, so on a
   * phone the only surface that says a divemaster is still uncalled was five
   * screens above the row that says who they are.
   */
  uncalledCrew: ReadonlyArray<{ id: string; fullName: string }>;
  /**
   * The divers a human has recorded as **not back aboard** at this checkpoint,
   * and the crew alongside them. Both halves, because the danger lines they
   * answer only ever carried counts: "1 crew member is not back aboard" named
   * nobody, on the half of the boat most reliably in the water, whose rows sit
   * below the entire diver roster with no way to reach them.
   *
   * The diver rows also float to the top of their own list (`order-first` in
   * `DiverRollCall`), and that is paint order only — DOM, tab and
   * screen-reader order are untouched, and a safety surface is the one place
   * `docs/design/accessibility-tradeoffs.md` refuses a visual-only
   * affordance. These chips are the mechanism that actually reaches everyone:
   * they are in the pinned half that cannot scroll away, they are keyboard
   * and AT reachable, and they cover crew, which no reordering of the diver
   * list can. Ordering is the nicety on top (dive-domain review 20260828).
   */
  notBackAboardDivers: ReadonlyArray<{ bookingId: string; fullName: string }>;
  notBackAboardCrew: ReadonlyArray<{ id: string; fullName: string }>;
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
  // goes quiet whenever a danger line above already names the same gap — and
  // for `divers_awaiting`, whose count the pinned row above now states as
  // "Awaiting N" the moment it is nonzero, so a sentence here restated the
  // one number a captain is already watching (principle 9). The diver gap
  // itself can never be suppressed by a crew emergency: the pinned count row
  // carries it, which is what DD1 asks — the crew states below keep their
  // sentences because crew have no entry on that row.
  // `no_divers` keeps the closing sentence it has always had — an empty roster
  // is its own problem and not one this line was ever written to explain.
  const mutedText =
    diversNotBackAboard || completeness.reason === "divers_awaiting"
      ? null
      : completeness.reason === "crew_not_back_aboard"
        ? null
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
  // "Who's left?" is a mid-roll-call question: at 0 recorded the chips would
  // restate the entire roster immediately above the roster itself (principle
  // 9), so they hold off until the first *diver* result lands. Keyed on the
  // divers rather than on either half because the diver list is the long one
  // — the whole point of the rule is not reprinting nine names, and two crew
  // names were never the restatement it guards against. The count line above
  // covers the starting state.
  //
  // Deliberately *not* also gated on "some crew recorded": once every diver is
  // settled and only the crew are open, the muted line says "2 crew members
  // still to call" and this is the one surface that can say which two.
  const rollCallStarted = summary.awaiting < summary.totalDivers;
  // Who the two danger lines are about. One list for both halves, for the same
  // reason `stillToCall` merges them: at the rail the question is "who is
  // still in the water?", and splitting the answer by whether the person holds
  // a booking makes a captain read two lists to answer one question. Divers
  // first, crew marked "(crew)" in the words the buddy panel already uses.
  const missing: Array<{ key: string; href: string; label: string }> = [
    ...notBackAboardDivers.map((diver) => ({
      key: `missing-diver-${diver.bookingId}`,
      href: `#diver-row-${diver.bookingId}`,
      label: diver.fullName,
    })),
    ...notBackAboardCrew.map((member) => ({
      key: `missing-crew-${member.id}`,
      href: `#crew-row-${member.id}`,
      label: t("manifest.buddyCrewName", { name: member.fullName }),
    })),
  ];
  const stillToCall: Array<{ key: string; href: string; label: string; blocked: boolean }> = [
    ...uncalled.map((diver) => ({
      key: `diver-${diver.bookingId}`,
      href: `#diver-row-${diver.bookingId}`,
      label: diver.fullName,
      // A readiness fact, and only at the dock: after a dive roll call is a
      // physical head count that readiness never gates, so the word would
      // compete with the one red on the page that means somebody is in the
      // water. The diver's own row applies the same rule.
      blocked: diver.blocked && isDeparture,
    })),
    ...uncalledCrew.map((member) => ({
      key: `crew-${member.id}`,
      href: `#crew-row-${member.id}`,
      // The buddy panel's marker, reused rather than re-worded: a crew member
      // reads as "the crew member (crew)" in both places on this page.
      label: t("manifest.buddyCrewName", { name: member.fullName }),
      // Crew carry no readiness at all, so there is no blocked state to say.
      blocked: false,
    })),
  ];
  return (
    <>
      {/* Pinned under the chrome bar by reading its height, never by
          measuring it: `top-(--chrome-h)` is the same declaration the bar sets
          its own height from (ADR 20260827-clearwater-surface-language,
          decision 10). This was `top-20` — 80px, measured once against a
          69px content-driven staff bar — which the moment the bar became 56px
          left 24px of scrolling roster showing between the two, on the surface
          a crew counts heads on. */}
      {/* One look, complete or not. The closed checkpoint used to turn the
          panel coral; ADR 20260901-diveday-reimagined's coral table puts
          coral on no manifest or roll call, and the moment here is the count
          that fills (slice 13h) — the water at the brim and the heading's
          word, never a wash behind the reading text. */}
      <section
        aria-labelledby="roll-call-progress-heading"
        className="sticky top-(--chrome-h) z-10 mt-4 rounded-panel border border-primary/30 bg-surface/95 p-4 shadow-lg backdrop-blur print:hidden"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className={groupLabelClass("primary")}>{t("manifest.activeCheckpoint")}</p>
            <h2
              id="roll-call-progress-heading"
              className="mt-1 flex items-center gap-2 text-lg font-bold"
            >
              {rollCallComplete ? <StatusMark variant="success" size="md" /> : null}
              <span>
                {rollCallComplete
                  ? t("manifest.rollCallComplete")
                  : rollCallCheckpointText(t, checkpoint)}
              </span>
            </h2>
          </div>
          {/* **The count leads the boat screen** (ADR
              20260827-the-departure-is-two-working-surfaces, decision 2). It is
              the one number a crew is holding in their head at the rail, so it
              is the biggest thing on the panel and always tabular — figures
              that hold their columns as they tick, rather than jumping a pixel
              left every time a 1 becomes a 2. Drawn as the figure whose water
              rises with the count (slice 13h); the bar that used to sit under
              it was the same fraction said twice.

              **The water counts divers aboard over who went out.** Not
              "recorded": a diver marked not back aboard has a result too, and
              a glass that filled on results stood at the brim with a diver in
              the water (dive-domain review 20260902). After a dive the glass
              is everyone who left the dock — `totalDivers − ashore` — so a
              diver who never boarded does not hold the figure short all day;
              at the dock it is everyone on the manifest. `ashore` is 0 at
              departure by construction, so one expression serves both. */}
          <HeadCount aboard={summary.boarded} out={summary.totalDivers - ashore} t={t} />
        </div>
        {/* The counts the six tiles used to carry, folded in under the bar they
            explain. A definition list, not a grid of cards: label/number pairs
            read in one pass and cost the roll-call list no vertical space on a
            phone. A zero-valued entry contributes nothing — "Boarded 0 · Not
            boarded 0 · Awaiting 8" before the first tap is three restatements
            of the fraction above (principle 9) — so each entry appears the
            moment its number does, and the whole row holds off until the
            first diver result lands: at rest its sole survivor, "Awaiting 8",
            is the arithmetic complement of the "0 of 8 recorded" fraction two
            lines up. The entries still sum to the boat: a dropped entry is
            exactly a zero. */}
        {rollCallStarted && counts.some((count) => count.value > 0) ? (
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-base">
            {counts
              .filter((count) => count.value > 0)
              .map((count) => (
                <div key={count.label} className="flex items-baseline gap-1.5">
                  <dt className="text-muted">{count.label}</dt>
                  <dd className="font-bold tabular-nums">{count.value}</dd>
                </div>
              ))}
          </dl>
        ) : null}
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
        {/* The names behind the two counts above, each a link to that person's
            own row. Pinned rather than in the scrolling half, and never gated
            on `rollCallStarted`: a stated "did not come back" is the one fact
            on this page that has to be reachable at any moment, and the chip
            is what makes it reachable by keyboard, by screen reader, and for
            crew — whose rows are below the whole diver roster. The glossary
            makes the argument for naming: a number that named nobody could not
            help anyone find a missing person. */}
        {missing.length > 0 ? (
          <ul
            className="mt-2 flex flex-wrap gap-2"
            aria-label={t("manifest.notBackAboardListLabel")}
          >
            {missing.map((person) => (
              <li key={person.key}>
                <a
                  href={person.href}
                  className="inline-flex min-h-11 items-center rounded-full border border-danger/60 bg-surface px-4 text-base font-semibold text-danger hover:bg-surface-sunken"
                >
                  {person.label}
                </a>
              </li>
            ))}
          </ul>
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

            **Names only, no initials avatar.** The face grid this replaced
            carried one, and dropping it was a deliberate call rather than an
            oversight: there are no photos anywhere in DiveDay, so the circle
            can only hold the initials of the name already printed beside it —
            it adds a second rendering of the same fact (principle 9) and buys
            no recognition on a dock the name did not already buy. Do not
            re-add it without photos to put in it.

            **Both halves of the head count.** Divers first, then crew, in one
            list rather than two: at the rail the question is "who have I not
            said anything about?", and splitting the answer by whether the
            person holds a booking makes a captain read two lists to answer
            one question. Crew chips carry the "(crew)" marker — the same
            words the buddy panel puts on a crew member, so the page says one
            thing one way. */}
        {rollCallStarted && stillToCall.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("manifest.stillToCallListLabel")}>
            {stillToCall.map((person) => (
              <li key={person.key}>
                <a
                  href={person.href}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-base font-semibold hover:bg-surface-sunken"
                >
                  {person.label}
                  {person.blocked ? (
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
            which sums to the boat (see `counts` above).

            `text-danger`, because blocked is danger everywhere else in the app
            and this panel was contradicting itself: the chip above renders the
            word "Blocked" in `readinessStatusTone`'s danger, while this
            sentence — counting the very same people — rendered
            `text-warning-strong`. One fact, two colours, twelve lines apart, on
            the surface that decides who boards. `readiness-labels.ts` and
            `staff-destinations.ts` (the nav's blocked badge) both already say
            danger; this is the third caller falling in behind them. Danger also
            clears AA at this size on a plain surface, which is what
            `text-warning-strong` was reaching for.

            **At the dock only.** After a dive this same sentence says the
            readiness follow-up happens ashore and never holds the count open —
            calm information about work for later, at a checkpoint where nothing
            has been recorded about anybody. Rendering it in danger there put
            red on the screen with no fact behind it, which is exactly what an
            alarm has to be earned against (ADR
            20260827-the-departure-is-two-working-surfaces, decision 4), and it
            competed with the one red that means somebody is in the water. */}
        {summary.blocked > 0 ? (
          <p
            className={`mt-1 text-base font-semibold ${isDeparture ? "text-danger" : "text-muted"}`}
          >
            {isDeparture
              ? t("manifest.blockedDeparture", { count: summary.blocked })
              : t("manifest.blockedAfterDive", { count: summary.blocked })}
          </p>
        ) : null}
      </div>
    </>
  );
}
