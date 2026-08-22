import { type EmergencyReference, hasEmergencyReference, telHref } from "@/lib/emergency-reference";

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
}: {
  reference: EmergencyReference;
  copy: EmergencyReferenceCopy;
  className?: string;
}) {
  const filled = hasEmergencyReference(reference);
  return (
    <section
      aria-labelledby="emergency-reference-heading"
      className={`rounded-2xl border border-danger/40 bg-danger/5 p-4 shadow-sm sm:p-5 ${className}`}
    >
      <h2 id="emergency-reference-heading" className="text-base font-semibold text-danger-strong">
        {copy.heading}
      </h2>
      {filled ? (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {reference.lines.map((line) => {
            const href = telHref(line.phone);
            return (
              <p key={`${line.label}-${line.phone}`} className="flex flex-wrap gap-x-2">
                {line.label ? <span className="font-medium">{line.label}</span> : null}
                {/* A real link where the number is dialable, plain text where it
                    is not — a tap that dials nothing costs a crew the one thing
                    they do not have. `print:no-underline` because paper cannot
                    be tapped and the rule only adds noise there. */}
                {href ? (
                  <a
                    href={href}
                    className="font-mono tabular-nums text-primary underline print:no-underline print:text-foreground"
                  >
                    {line.phone}
                  </a>
                ) : (
                  <span className="font-mono tabular-nums">{line.phone}</span>
                )}
              </p>
            );
          })}
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
