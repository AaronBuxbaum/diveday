import { entryMainClass, entryPanelClass } from "@/components/account/EntryShell";
import { type SkeletonLines, SkeletonLineBars } from "@/components/ShopPageHeader";

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
 *
 * A door's words wrap, and a bar cannot: how many lines the title, the
 * description, a panel's sentence and each footer sentence wrap to is the
 * page's to say, in `ShopPageHeaderSkeleton`'s spelling (`SkeletonLines`: one
 * count, or one below `sm` and one from it).
 */
export function EntryShellSkeleton({
  wordmark = false,
  eyebrow = false,
  titleLines = 1,
  description = true,
  descriptionLines = 1,
  width = "sm",
  panel = true,
  fields = [],
  body,
  trailingLink = false,
  footnote = true,
}: {
  wordmark?: boolean;
  /** Stands in for the small uppercase line above the title. */
  eyebrow?: boolean;
  /** How many lines the title wraps to. */
  titleLines?: SkeletonLines;
  /** `false` for a door whose shell has no `description` (sign-in, verify, onboarding). */
  description?: boolean;
  /** How many lines the description wraps to. */
  descriptionLines?: SkeletonLines;
  width?: "sm" | "lg";
  panel?: boolean;
  fields?: readonly string[];
  /**
   * A panel that holds a sentence and one button rather than a form — the
   * closed onboarding door — as the number of lines the sentence wraps to.
   */
  body?: SkeletonLines;
  /** A text link after the last field — sign-in's "Forgot password?". */
  trailingLink?: boolean;
  /**
   * The footer's row: `true` for one one-line sentence, or the lines each of
   * its sentences wraps to (`[2, 1]`: a two-line sentence over a one-line one).
   */
  footnote?: boolean | readonly SkeletonLines[];
}) {
  return (
    <main className={entryMainClass(width)}>
      <div className="animate-pulse">
        {/* The shell's `<header>`, bar for line. The wordmark's `mb-8` is the
            wordmark's own, as the shell's is, so an eyebrow under it stands
            32px down and 8px over the title; the title bar carried the 32px,
            which stood a demo door's eyebrow flush under its wordmark
            (K-576). The bars are the shell's own line boxes, read off
            `EntryShell`: the wordmark is a 24px lockup (`h-6`), the eyebrow
            `EYEBROW_CLASS`'s `leading-4` (`h-4`), the `<h1>`
            `SHELL_TITLE_CLASS` at both widths, whose `text-3xl` line box is
            36px (`h-9`), and the description an unsized `<p>` at 24px (`h-6`)
            under the header's own `mt-2`. */}
        <div>
          {wordmark ? <div className="mx-auto mb-8 h-6 w-28 rounded bg-surface-sunken" /> : null}
          {eyebrow ? <div className="mx-auto mb-2 h-4 w-24 rounded bg-surface-sunken" /> : null}
          <SkeletonLineBars lines={titleLines} height="h-9" width="mx-auto w-56 max-w-full" />
          {description ? (
            <div className="mt-2">
              <SkeletonLineBars
                lines={descriptionLines}
                height="h-6"
                width="mx-auto w-72 max-w-full"
              />
            </div>
          ) : null}
        </div>
        {/* The form's own rhythm: every door's form is `flex flex-col gap-4`
            around a `buttonClass()` submit, which is `md`, 48px — so the
            button bar is `mt-4 h-12`. It was `mt-6 h-11`, drawn before `md`
            was 48px, and the form moved 4px when it streamed in.

            Sign-in's "Forgot password?" is a 48px link pulled to 32px of flow
            by its `-my-2`, between two of those 16px gaps: an `h-8` row with
            a text bar at its end, where the link's words end.

            A door with no form (`body`) holds a `<p>` and its one button
            `mt-6` under it, so the sentence's line boxes and then `mt-6 h-12`. */}
        {panel ? (
          <div className={entryPanelClass}>
            {fields.map((slot, index) => (
              <div key={slot} className={index === 0 ? "" : "mt-4"}>
                <div className="h-4 w-28 rounded bg-surface-sunken" />
                <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
              </div>
            ))}
            {body !== undefined ? (
              <SkeletonLineBars lines={body} height="h-6" width="w-full max-w-sm" />
            ) : null}
            {trailingLink ? (
              <div className="mt-4 flex h-8 items-center justify-end">
                <div className="h-4 w-32 rounded bg-surface-sunken" />
              </div>
            ) : null}
            <div
              className={`${body !== undefined ? "mt-6" : "mt-4"} h-12 w-full rounded-lg bg-surface-sunken`}
            />
          </div>
        ) : (
          <div className="mx-auto mt-8 h-12 w-44 rounded-lg bg-surface-sunken" />
        )}
        {/* The footer's row: `EntryShell`'s footer is `mt-8` over `text-sm`
            lines, and its 44px links hand back what they add to the line
            (`FOOTER_LINK_SLOT`), so the row is 20px. The bar stands centred
            in an `h-5` row at the same margin; it was a bare `h-4` bar, 4px
            short of the line it stood in for. A footer of several sentences
            is the shell's `gap-2` column of them, a 20px line box for each
            line each one wraps to. */}
        {footnote === true ? (
          <div className="mt-8 flex h-5 items-center justify-center">
            <div className="h-4 w-44 rounded bg-surface-sunken" />
          </div>
        ) : footnote ? (
          <div className="mt-8 flex flex-col gap-2">
            {footnote.map((lines, row) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records — the row number is the only identity a placeholder row has
              <div key={row}>
                <SkeletonLineBars lines={lines} height="h-5" width="mx-auto w-72 max-w-full" />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
