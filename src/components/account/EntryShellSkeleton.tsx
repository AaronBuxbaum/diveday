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
  description = true,
  width = "sm",
  panel = true,
  fields = [],
  trailingLink = false,
  footnote = true,
}: {
  wordmark?: boolean;
  /** Stands in for the small uppercase line above the title. */
  eyebrow?: boolean;
  /** `false` for a door whose shell has no `description` (sign-in, verify, onboarding). */
  description?: boolean;
  width?: "sm" | "lg";
  panel?: boolean;
  fields?: readonly string[];
  /** A text link after the last field — sign-in's "Forgot password?". */
  trailingLink?: boolean;
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
        {description ? (
          <div className="mx-auto mt-2 h-6 w-72 max-w-full rounded bg-surface-sunken" />
        ) : null}
        {/* The form's own rhythm: every door's form is `flex flex-col gap-4`
            around a `buttonClass()` submit, which is `md`, 48px — so the
            button bar is `mt-4 h-12`. It was `mt-6 h-11`, drawn before `md`
            was 48px, and the form moved 4px when it streamed in.

            Sign-in's "Forgot password?" is a 48px link pulled to 32px of flow
            by its `-my-2`, between two of those 16px gaps: an `h-8` row with
            a text bar at its end, where the link's words end. */}
        {panel ? (
          <div className={entryPanelClass}>
            {fields.map((slot, index) => (
              <div key={slot} className={index === 0 ? "" : "mt-4"}>
                <div className="h-4 w-28 rounded bg-surface-sunken" />
                <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
              </div>
            ))}
            {trailingLink ? (
              <div className="mt-4 flex h-8 items-center justify-end">
                <div className="h-4 w-32 rounded bg-surface-sunken" />
              </div>
            ) : null}
            <div className="mt-4 h-12 w-full rounded-lg bg-surface-sunken" />
          </div>
        ) : (
          <div className="mx-auto mt-8 h-12 w-44 rounded-lg bg-surface-sunken" />
        )}
        {/* The footer's row: `EntryShell`'s footer is `mt-8` over `text-sm`
            lines, and its 44px links hand back what they add to the line
            (`FOOTER_LINK_SLOT`), so the row is 20px. The bar stands centred
            in an `h-5` row at the same margin; it was a bare `h-4` bar, 4px
            short of the line it stood in for. */}
        {footnote ? (
          <div className="mt-8 flex h-5 items-center justify-center">
            <div className="h-4 w-44 rounded bg-surface-sunken" />
          </div>
        ) : null}
      </div>
    </main>
  );
}
