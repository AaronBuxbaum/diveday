import { type EmergencyReference, hasEmergencyReference } from "@/lib/emergency-reference";

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
  /** Shown to staff when the shop has recorded nothing — never to hide the panel. */
  empty: string;
  vesselLabel: string;
  shoreContactLabel: string;
  planLabel: string;
};

export function EmergencyReferenceCard({
  reference,
  copy,
  className = "",
  headingId = "emergency-reference-heading",
}: {
  reference: EmergencyReference;
  copy: EmergencyReferenceCopy;
  className?: string;
  /** Unique when several responsive/print copies share a page. */
  headingId?: string;
}) {
  const filled = hasEmergencyReference(reference);
  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-panel border border-danger/40 bg-danger/5 p-4 sm:p-5 ${className}`}
    >
      <h2 id={headingId} className="text-base font-semibold text-danger-strong">
        {copy.heading}
      </h2>
      {filled ? (
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
          {reference.vessel ? (
            <p>
              <span className="font-medium">{copy.vesselLabel}</span> {reference.vessel}
            </p>
          ) : null}
          {reference.shoreContact ? (
            <p>
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
      ) : (
        // Never nothing: a silently empty panel is indistinguishable from a shop
        // that has no numbers, and getting shops to fill it in is the whole value.
        <p className="mt-2 text-sm text-muted">{copy.empty}</p>
      )}
    </section>
  );
}
