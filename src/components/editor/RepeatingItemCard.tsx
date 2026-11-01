import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * Shared card for temporary repeating fields in long editors (docs/design/
 * forms-and-controls.md). Its sunken inset, header-aligned remove action, and
 * field spacing follow docs/design/pixel-craft.md, class 12. Keep the action
 * at the header's end even when an item has no title.
 */
export const REPEATING_ITEM_CARD_CLASS = "rounded-inset border border-border bg-surface-sunken p-4";

/**
 * Danger action for an unsaved row, not record deletion; flush aligns its
 * label with the card content edge.
 */
export const repeatingItemRemoveClass = buttonClass({
  variant: "danger-ghost",
  size: "sm",
  flush: true,
  className: "print:hidden",
});

/** The one "Add a …" under a list of these, whichever editor it belongs to. */
export const repeatingItemAddClass = buttonClass({
  variant: "secondary",
  size: "sm",
  className: "print:hidden",
});

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
