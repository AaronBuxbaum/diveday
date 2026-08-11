/**
 * The "this opens" mark on a disclosure: a chevron pointing right at rest,
 * rotated a quarter turn once the thing is open.
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
 * `group-open/facts:rotate-90`, or a plain `rotate-90` for a React-state
 * toggle that is not a `<details>` at all.
 */
export function DisclosureCaret({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-3 shrink-0 transition-transform duration-200 ${className}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
