import { entryMainClass, entryPanelClass } from "@/components/account/EntryShell";

/**
 * Body-shaped skeleton matching `EntryShell` (design principle 1): centered
 * title and description bars, then either the form panel (borderless on a
 * phone, a bordered surface from `sm` up — the *same* exported class
 * constants as the real shell, so nothing can drift or shift when the page
 * streams in) or, for the single-button doors (`panel={false}`), a centered
 * button bar.
 *
 * `fields` is a list of slot names, one per stacked label+control pair, so
 * each page's skeleton carries the same number of rows as its real form.
 */
export function EntryShellSkeleton({
  wordmark = false,
  eyebrow = false,
  width = "sm",
  panel = true,
  fields = [],
  footnote = true,
}: {
  wordmark?: boolean;
  /** Stands in for the small uppercase line above the title. */
  eyebrow?: boolean;
  width?: "sm" | "lg";
  panel?: boolean;
  fields?: readonly string[];
  footnote?: boolean;
}) {
  return (
    <main className={entryMainClass(width)}>
      <div className="animate-pulse">
        {wordmark ? <div className="mx-auto h-6 w-28 rounded bg-surface-sunken" /> : null}
        {eyebrow ? <div className="mx-auto mb-2 h-4 w-24 rounded bg-surface-sunken" /> : null}
        {/* The bars are the shell's own line boxes, read off `EntryShell`: the
            `<h1>` is `SHELL_TITLE_CLASS` at both widths now, whose `text-3xl`
            line box is 36px (`h-9`), and the description is an unsized `<p>` at
            24px (`h-6`) under the header's own `mt-2`. They were `h-8` and
            `mt-3 h-4` — a title bar sized for the `text-2xl` this shell no
            longer renders, over a description bar a third too short. */}
        <div
          className={`mx-auto h-9 w-56 max-w-full rounded bg-surface-sunken ${wordmark ? "mt-8" : ""}`}
        />
        <div className="mx-auto mt-2 h-6 w-72 max-w-full rounded bg-surface-sunken" />
        {panel ? (
          <div className={entryPanelClass}>
            {fields.map((slot, index) => (
              <div key={slot} className={index === 0 ? "" : "mt-4"}>
                <div className="h-4 w-28 rounded bg-surface-sunken" />
                <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
              </div>
            ))}
            <div className="mt-6 h-11 w-full rounded-lg bg-surface-sunken" />
          </div>
        ) : (
          <div className="mx-auto mt-8 h-11 w-44 rounded-lg bg-surface-sunken" />
        )}
        {footnote ? <div className="mx-auto mt-8 h-4 w-44 rounded bg-surface-sunken" /> : null}
      </div>
    </main>
  );
}
