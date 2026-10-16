import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { scopedId } from "@/lib/element-id";
import type { PrepView } from "./prep-view";

/**
 * **"Lunch for 14"**, and what each person can't eat (fifth-loop ideas, item
 * 56): only on a departure that serves lunch aboard. Printed with the paper
 * day, which composes this list.
 */
export function PrepLunch({ view }: { view: PrepView }) {
  const { prep, t, idPrefix } = view;
  const lunch = prep.lunch;
  if (!lunch) return null;
  return (
    <section aria-labelledby={scopedId(idPrefix, "lunch-heading")} data-testid="prep-lunch">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={scopedId(idPrefix, "lunch-heading")} className={SECTION_TITLE_CLASS}>
          {t("tripPrep.lunch.heading")}
        </h2>
        <span className="text-sm text-muted tabular-nums">
          {t("tripPrep.lunch.count", { count: lunch.count })}
        </span>
      </div>
      {lunch.notes.length > 0 ? (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface shadow-bed">
          {lunch.notes.map((entry) => (
            <li key={`${entry.name}:${entry.note}`} className="px-4 py-3 text-sm">
              {t("tripPrep.lunch.note", { name: entry.name, note: entry.note })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">{t("tripPrep.lunch.noNotes")}</p>
      )}
    </section>
  );
}
