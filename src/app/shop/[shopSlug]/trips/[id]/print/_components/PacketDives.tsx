import type { StaffTranslator } from "@/i18n/staff-messages";

/** One planned dive, as the packet prints it. */
export type PacketDive = {
  diveNumber: number;
  /** The site's name, or the shop's own title for the dive when it named no site. */
  heading: string | null;
  travelMinutes: number | null;
  description: string | null;
};

/**
 * **The dive plan, on paper, with nothing to tap.**
 *
 * The packet used to reach this by composing the Overview *tab*, which is the
 * trip's edit form — so the plan printed as a `<select>` of dive sites, a
 * `<textarea>` per dive, and a number box for travel minutes, beside a button
 * labelled "Cancel trip" (issue #814). A sheet a captain carries onto a boat
 * cannot have a dropdown drawn on it, and a control that looks fillable and
 * records nothing is worse than no control at all.
 *
 * So the packet renders the same facts itself, from the same reader the
 * Overview page uses (`getTripOverview`), and renders them as words. Only the
 * facts that live *nowhere else in the packet*: the manifest section already
 * carries the roster, each diver's emergency contact and the head count, and
 * the prep section carries the gear, so repeating any of that here would be a
 * second copy to keep in step rather than a document.
 *
 * Admission requirements are deliberately absent. They decide who may *book*,
 * which is answered before the boat leaves, and the manifest prints each
 * diver's own readiness — a trip-level "requires Nitrox" line on the sheet
 * would invite re-adjudicating a diver at the rail against a rule the office
 * already applied.
 */
export function PacketDives({
  dives,
  description,
  conditions,
  t,
}: {
  dives: readonly PacketDive[];
  description: string | null;
  conditions: string | null;
  t: StaffTranslator;
}) {
  if (dives.length === 0 && !description && !conditions) return null;
  return (
    <div className="mt-6">
      {description ? <p className="text-base whitespace-pre-line">{description}</p> : null}
      {dives.length > 0 ? (
        <ol className="mt-4 flex flex-col gap-4">
          {dives.map((dive) => (
            <li key={dive.diveNumber}>
              <p className="text-base font-semibold">
                {t("shared.printPacket.diveNumber", { number: dive.diveNumber })}
                {dive.heading ? ` · ${dive.heading}` : ""}
              </p>
              {dive.travelMinutes === null ? null : (
                <p className="text-sm text-muted">
                  {t("shared.printPacket.travelMinutes", { minutes: dive.travelMinutes })}
                </p>
              )}
              {dive.description ? (
                <p className="mt-1 text-sm whitespace-pre-line">{dive.description}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {conditions ? (
        <div className="mt-5">
          <p className="text-sm font-semibold">{t("shared.printPacket.conditionsHeading")}</p>
          <p className="mt-1 text-sm whitespace-pre-line">{conditions}</p>
        </div>
      ) : null}
    </div>
  );
}
