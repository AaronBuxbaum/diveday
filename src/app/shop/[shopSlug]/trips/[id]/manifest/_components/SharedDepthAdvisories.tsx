import { StatusMark } from "@/components/ui/StatusMark";
import { depthWarningText } from "@/i18n/depth-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import type { TripManifest } from "@/lib/manifests";
import { SHARED_FACT_MIN } from "../../_components/shared-facts";

/**
 * The depth advisories enough of the roster shares to be said once, as
 * `[sentence, the divers it names]`, and the set of those sentences a row's
 * own panel then leaves out.
 */
export function sharedDepthAdvisories(divers: TripManifest["divers"], t: StaffTranslator) {
  // The same depth advisory resolving identically for much of the roster is
  // one fact about the plan, not nine facts about nine divers (principle 9) —
  // on the seeded wreck trip the identical 40-word paragraph rendered inside
  // nine of ten rows. Said once here, naming its divers; each of their rows
  // wears a two-word capsule instead. A diver whose advisory *differs* (a junior
  // cap, no card at all) keeps the full sentence in their panel, and **paper
  // keeps every row's full advisory** — the printed manifest goes ashore, and
  // a capsule pointing at a strip is a reference paper cannot follow.
  const advisoryDivers = new Map<string, string[]>();
  for (const diver of divers) {
    if (
      diver.depthAdvisory?.status !== "exceeds" &&
      diver.depthAdvisory?.status !== "verification_required"
    )
      continue;
    const text = depthWarningText(t, diver.depthAdvisory);
    advisoryDivers.set(text, [...(advisoryDivers.get(text) ?? []), diver.fullName]);
  }
  const sharedAdvisories = [...advisoryDivers.entries()].filter(
    ([, names]) => names.length >= SHARED_FACT_MIN,
  );
  const sharedAdvisoryTexts = new Set(sharedAdvisories.map(([text]) => text));
  return { sharedAdvisories, sharedAdvisoryTexts };
}

/** The strip above the list that says a shared advisory once, naming its divers. */
export function SharedDepthAdvisories({
  sharedAdvisories,
  locale,
  t,
}: {
  sharedAdvisories: ReadonlyArray<readonly [text: string, names: readonly string[]]>;
  locale: string;
  t: StaffTranslator;
}) {
  if (sharedAdvisories.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 print:hidden">
      {sharedAdvisories.map(([text, names]) => (
        <div
          key={text}
          className="flex gap-2 rounded-lg bg-warning-tint px-3 py-2 text-base text-warning-strong"
        >
          <StatusMark variant="warning" size="md" />
          <div>
            <p>{text}</p>
            <p className="font-semibold">
              {t("manifest.sharedDepthApplies", {
                names: cachedListFormat(locale, {
                  style: "long",
                  type: "conjunction",
                }).format(names),
              })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
