import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * **One item of a long editor's repeating list** — a course's day, one of its
 * questions, a dive site's landmark, a species in its field guide.
 *
 * The four editors each drew their own, and on one page they read as four
 * different objects (docs/design/pixel-craft.md, class 12): the day cards were
 * unfilled with a bordered red "Remove day" at their head, the question cards
 * grey with a borderless red "Remove question 1" at their foot, and the landmark
 * and field-guide cards grey at 12px of padding with a grey Remove inside a row
 * of fields; "Add day" stood at 48px where "Add a question" stood at 44px.
 *
 * So there is one: a sunken inset (the thing `SectionCard`'s documentation says
 * is *carved into* a surface rather than raised on it) with 16px of padding, a
 * header row holding the item's title and its remove act, and the fields
 * under it. The remove act always sits at the header's end, whether or not the
 * item has a title of its own, so a staffer finds it in one place on every
 * card. Fields inside keep `FieldGrid`'s one 16px gap.
 */
export const REPEATING_ITEM_CARD_CLASS = "rounded-inset border border-border bg-surface-sunken p-4";

/**
 * Every item's remove act: the danger hue without a box, because it removes a
 * row from a form that is not saved yet rather than deleting a record, and
 * `flush`, so its label ends on the card's content edge while its hover tint
 * reaches 8px past it.
 */
export const repeatingItemRemoveClass = buttonClass({
  variant: "danger-ghost",
  size: "sm",
  flush: true,
});

/** The one "Add a …" under a list of these, whichever editor it belongs to. */
export const repeatingItemAddClass = buttonClass({ variant: "secondary", size: "sm" });

export function RepeatingItemCard({
  as: Tag = "div",
  title,
  remove,
  children,
}: {
  /** `li` when the editor's items are a list. */
  as?: "div" | "li";
  /** The item's own heading, where it has one ("Day 2", a species' name). */
  title?: ReactNode;
  /** The remove act, drawn with `repeatingItemRemoveClass`. */
  remove: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tag className={REPEATING_ITEM_CARD_CLASS}>
      <div className="flex items-center justify-between gap-3">
        {/* Always rendered, so a title-less item's remove still sits at the end. */}
        <div className="min-w-0 flex-1">{title}</div>
        {remove}
      </div>
      <div className="mt-3">{children}</div>
    </Tag>
  );
}
