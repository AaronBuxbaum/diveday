import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

/** Persisted supplementary facts, separate from a live editor's unsubmitted controls. */
export function SavedPrintDetails({
  title,
  sections,
}: {
  title: string;
  sections: readonly { title: string; lines: readonly (string | null | undefined)[] }[];
}) {
  const saved = sections
    .map((section) => ({
      ...section,
      lines: section.lines.filter((line): line is string => Boolean(line?.trim())),
    }))
    .filter((section) => section.lines.length > 0);
  if (saved.length === 0) return null;
  return (
    <section data-saved-print-details className="mt-6 hidden space-y-4 print:block">
      <h2 className={SECTION_TITLE_CLASS}>{title}</h2>
      {saved.map((section) => (
        <section key={section.title}>
          <h3 className="text-sm font-semibold">{section.title}</h3>
          {[...new Set(section.lines)].map((line) => (
            <p key={line} className="mt-1 text-sm whitespace-pre-wrap break-words">
              {line}
            </p>
          ))}
        </section>
      ))}
    </section>
  );
}
