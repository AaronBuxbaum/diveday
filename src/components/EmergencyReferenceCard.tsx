import { TONE_PANEL_CLASS, TONE_PANEL_IN_OVERLAY_CLASS } from "@/components/ui/card";
import { type DepartureEmergencyReference, hasEmergencyReference } from "@/lib/emergency-reference";

/**
 * **The card a crew reads during, on every surface that survives a bad day.**
 *
 * Rendered on the live manifest, in the printed packet, and inside the offline
 * viewer — paper being the fallback under the fallback. Every value is the
 * shop's own; DiveDay authors none of them (issue #688).
 *
 * Takes its words as props: the offline viewer is a Client Component with no
 * translator, and staff copy never crosses that boundary (AGENTS.md).
 *
 * **No colour alone and no icon alone.** This is a safety surface, so every
 * line states what it is in words — a crew member reading a wet screen in glare
 * is the standard user here (design principle 6).
 */
export type EmergencyReferenceCopy = {
  heading: string;
  /** The absence, stated, when the shop has recorded nothing — never a hidden panel. */
  empty: string;
  vesselLabel: string;
  callSignLabel: string;
  mmsiLabel: string;
  /**
   * "Working channel (VHF):" — the boat's working channel (issue #2672).
   * Never a bare "Channel": on a card headed "In an emergency" that reads as
   * the channel to call on (dock review B1).
   */
  workingChannelLabel: string;
  /** "not recorded", for a boat whose row holds no working channel. */
  workingChannelNotRecorded: string;
  /** The fixed line under it: distress and calling stay on VHF 16. */
  distressChannel: string;
  shoreContactLabel: string;
  planLabel: string;
};

export function EmergencyReferenceCard({
  reference,
  copy,
  className = "",
  headingId = "emergency-reference-heading",
  inOverlay = false,
}: {
  /** The departure's own boat rides on it when there is one (`emergencyReferenceForDeparture`). */
  reference: DepartureEmergencyReference;
  copy: EmergencyReferenceCopy;
  className?: string;
  /** Unique when several responsive/print copies share a page. */
  headingId?: string;
  /**
   * Carried inside a menu or a sheet that lifts it (the manifest's phone
   * menu): the card drops the bed a panel at rest stands on, and keeps its
   * tone, words and padding.
   */
  inOverlay?: boolean;
}) {
  const filled = hasEmergencyReference(reference);
  return (
    // **The same chrome full or empty.** The tint is the card's identity on a
    // wet screen in glare, not an alarm that fires on a condition — a crew
    // finds the red box before it reads a word of it, and a panel that went
    // neutral exactly when there is nothing under it is the one a crew skims
    // past. Colour carries nothing on its own here: every line says what it is
    // in words (design principle 6).
    <section
      aria-labelledby={headingId}
      className={`${inOverlay ? TONE_PANEL_IN_OVERLAY_CLASS : TONE_PANEL_CLASS} border-danger/40 bg-danger/5 ${className}`}
    >
      <h2 id={headingId} className="text-base font-semibold text-danger">
        {copy.heading}
      </h2>
      {filled || reference.boat ? (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {reference.lines.map((line) => (
            <p key={`${line.label}-${line.phone}`} className="flex flex-wrap gap-x-2">
              {line.label ? <span className="font-medium">{line.label}</span> : null}
              {/* **Reference text, never a control that can dial.** ADR
                  20260827-the-departure-is-two-working-surfaces, decision 3:
                  "There are no call buttons anywhere on the boat." DiveDay is
                  not an emergency dispatcher — no coastguard call will ever
                  originate from this app, a real response starts with the radio
                  and the O2 kit, and this card is consulted calmly less than
                  once a year. A control that can dial by accident buys nothing
                  on that path and costs a false alarm the one time it misfires.
                  These were `tel:` links until slice 5a; both the design and
                  dive-domain reviews of that slice called it the surface's
                  clearest contradiction of its own record. Every place this card
                  renders is a boat surface or paper — the live manifest, the
                  offline copy, the printed packet — so the link had no reader
                  it was right for. */}
              <span className="font-mono tabular-nums">{line.phone}</span>
            </p>
          ))}
          {/* `text-pretty` on the two free-text lines: the shop's own words
              wrap, and in Spanish the vessel line ended on one word. */}
          {/* **The departure's own boat**, off its row in Settings > Boats
              (fourth review, item 11): the name, then the two facts read
              over the radio, each on its own labelled line so a figure is
              never read as the other. The shop's vessel line is the fallback
              for a departure on no boat, and for a boat whose row holds no
              radio fact yet (review B1), where it prints unlabelled under
              the boat's name, a note on this boat rather than a second vessel. */}
          {reference.boat ? (
            <>
              <p className="text-pretty">
                <span className="font-medium">{copy.vesselLabel}</span> {reference.boat.name}
              </p>
              {reference.boat.callSign ? (
                <p>
                  <span className="font-medium">{copy.callSignLabel}</span>{" "}
                  <span className="font-mono">{reference.boat.callSign}</span>
                </p>
              ) : null}
              {reference.boat.mmsi ? (
                <p>
                  <span className="font-medium">{copy.mmsiLabel}</span>{" "}
                  <span className="font-mono tabular-nums">{reference.boat.mmsi}</span>
                </p>
              ) : null}
              {/* The channel the boat works on (issue #2672), on its own
                  line so it is never read as part of the MMSI, always named
                  a working channel and always followed by the fixed line
                  that distress stays on 16 (dock review B1). An empty one
                  says so rather than vanishing. */}
              <p>
                <span className="font-medium">{copy.workingChannelLabel}</span>{" "}
                {reference.boat.workingChannel ? (
                  <span className="font-mono tabular-nums">{reference.boat.workingChannel}</span>
                ) : (
                  copy.workingChannelNotRecorded
                )}
              </p>
              <p className="font-medium">{copy.distressChannel}</p>
              {reference.vessel ? <p className="text-pretty">{reference.vessel}</p> : null}
            </>
          ) : reference.vessel ? (
            <p className="text-pretty">
              <span className="font-medium">{copy.vesselLabel}</span> {reference.vessel}
            </p>
          ) : null}
          {reference.shoreContact ? (
            <p className="text-pretty">
              <span className="font-medium">{copy.shoreContactLabel}</span> {reference.shoreContact}
            </p>
          ) : null}
          {reference.plan ? (
            <div>
              <p className="font-medium">{copy.planLabel}</p>
              {/* The shop's own words, kept as they were typed — a plan is
                  read in the order it was written. */}
              <p className="mt-0.5 whitespace-pre-line">{reference.plan}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {filled ? null : (
        // Never nothing: a silently empty panel is indistinguishable from a shop
        // that has no numbers. It states the absence and asks for nothing —
        // this reader is offshore, with no signal and usually no permission to
        // open Settings, so "add them in Settings" would be an errand they
        // cannot run. The errand belongs on the Settings hub, where the same
        // absence reads "Nothing recorded" beside the form that fixes it.
        <p className="mt-2 text-sm text-muted">{copy.empty}</p>
      )}
    </section>
  );
}
