/**
 * The one status-mark vocabulary, and the one place it is written down.
 *
 * A decorative, `aria-hidden` mark that goes before a status's own words —
 * `Badge`'s pill, `FormStatus`'s line beside a submit button, `ShopNotice`'s
 * page banner. Status on those surfaces is otherwise hue plus reading the
 * words, which a colourblind scan can miss before it gets to the words at all.
 *
 * Only the three tones that mean a pass/fail/caution status get a mark.
 * `primary` and `neutral` are counts and labels — nothing to disambiguate —
 * so this returns `undefined` for them and a caller cannot mark a count.
 *
 * Emoji, not the dingbats (`✓ ▲ ✕`) this shipped with. Those are *text*
 * codepoints: they take the surrounding font and colour, so at badge sizes
 * they render as thin monochrome marks that read as a font falling back
 * rather than as a status — the danger one, sitting on the Today tab's blocked
 * count, was reported from the field as a stray glyph in the copy. An emoji
 * carries its own two-colour artwork at any size and cannot be mistaken for
 * broken text. Do not "tidy" these back into text marks.
 *
 * No trailing space in the strings: the gap belongs to the consumer's layout
 * (`gap-1`, `gap-1.5`, `mr-1`), where it can be tuned per surface and does not
 * silently collapse the way a space in a JSX text node can.
 *
 * This lived three times — `badge.tsx`, `form.tsx`, and `ShopPageHeader.tsx`,
 * each citing the others in a comment and none of them importing — and the
 * copies had already drifted: two used `gap-1` and the third baked a trailing
 * space into every string.
 */

/** Every tone name the three consumers use, unioned. */
export type ToneName = "primary" | "neutral" | "success" | "warning" | "danger";

const TONE_GLYPH: Partial<Record<ToneName, string>> = {
  success: "✅",
  warning: "⚠️",
  danger: "❌",
};

export function toneGlyph(tone: ToneName): string | undefined {
  return TONE_GLYPH[tone];
}
