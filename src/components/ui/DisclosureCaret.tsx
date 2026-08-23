/**
 * The two rest positions a disclosure caret can take, as the only thing that
 * differs between them: the path.
 *
 * `right` is the app's default — a chevron the caller rotates 90° on open.
 * `down` is the other grammar this app already had, hand-inlined four times
 * (the trip Overview's edit disclosures, the roster's per-diver "Details", and
 * two on the Guests page): a chevron trailing a *label* rather than leading a
 * row, which the caller flips 180° on open. They were not one component only
 * because this one could not say "down"; each copy then drifted its own viewBox
 * (20 vs 24) and stroke weight (1.5 vs 2).
 */
const CARET_PATHS = {
  right: "m9 6 6 6-6 6",
  down: "m6 9 6 6 6-6",
} as const;

export type DisclosureCaretDirection = keyof typeof CARET_PATHS;

/**
 * The "this opens" mark on a disclosure: a chevron pointing right at rest,
 * rotated a quarter turn once the thing is open — or pointing down, and
 * rotated a half turn, when the caller says `direction="down"`.
 *
 * **Drawn, not typed.** Every one of these used to be a literal `▸` in a
 * `<span>`, and at 12px in the app's UI stack that glyph renders as a small
 * filled smudge — a review of the manifest read the one beside "Buddy teams"
 * as a stray dot rather than as a control. Same reasoning as `ShopNotice`'s
 * tone glyphs (ShopPageHeader.tsx) and `Badge`'s: a text dingbat at affordance
 * size reads as a font falling back, not as an affordance. A stroked path
 * scales with the label and stays a chevron in every font stack.
 *
 * Always decorative. `<details>` (or `aria-expanded` on a button) is what
 * carries the open state to a screen reader, so this never announces.
 *
 * The rotation is the caller's to name, because Tailwind's `group-open/<name>`
 * variant has to be written out in full where the group is declared — pass
 * `group-open/facts:rotate-90` (or `:rotate-180` for a `down` caret), or a
 * plain `rotate-90` for a React-state toggle that is not a `<details>` at all.
 * The size is the caller's too, for the same reason `settings/export` already
 * passes `size-4`: `size-3` is the default, not the rule.
 */
export function DisclosureCaret({
  direction = "right",
  className = "",
}: {
  direction?: DisclosureCaretDirection;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-3 shrink-0 transition-transform ${className}`}
    >
      <path d={CARET_PATHS[direction]} />
    </svg>
  );
}
