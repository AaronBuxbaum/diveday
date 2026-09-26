import type { ReactNode } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";

/**
 * **The shared "nothing here yet" card, with a shape rather than a slot.**
 *
 * This owned the box — dashed border, bubbles, `p-10` — and left everything
 * inside it to `children`, so 46 call sites invented 46 anatomies. Twenty of
 * them were a single muted sentence with no heading at all, which is
 * `docs/design/brand.md`'s "No records found" wearing a nicer border, on a
 * surface whose own principle says empty states *teach* ("No trips yet —
 * schedule your first charter"). The rest split between `h2` and `h3` by
 * nothing more than where they happened to sit (issue #774).
 *
 * This is the fix `SectionCard` already got, one primitive later: name the
 * slots, and a call site stops choosing. **There is deliberately no
 * `children`** — an escape hatch beside the props is what let the drift happen,
 * and an abstraction that preserves each call site's current shape is not a
 * design system.
 *
 * `title` is a **heading**, at one size and one weight, with `titleAs` for the
 * level — exactly `SectionCard`'s arrangement, for the same reason. The look is
 * the component's and never drifts; the *level* genuinely depends on how deeply
 * the card is nested, which is document structure rather than style, and which
 * a component cannot work out for itself. `titleId` is for the one card that is
 * its section's `aria-labelledby` target.
 *
 * `action` is optional on purpose. Some of these are states the reader cannot
 * do anything about — no reviews written yet, no waivers signed yet — and a
 * required action prop would manufacture a button for them.
 */
const TITLE_TAG = { h2: "h2", h3: "h3" } as const;

export function EmptyState({
  title,
  titleAs = "h2",
  titleId,
  body,
  action,
  className,
  icon = true,
  nested = false,
}: {
  /** The teaching line. One sentence: what is not here, and usually why. */
  title: ReactNode;
  /** `h3` inside a section that already has an `h2`; see `SectionCard`. */
  titleAs?: keyof typeof TITLE_TAG;
  /** Only where the card is its section's accessible name. */
  titleId?: string;
  /** One more line, where the title alone would leave the reader guessing. */
  body?: ReactNode;
  /** The next step, where there is one. A link or a button, never a paragraph. */
  action?: ReactNode;
  className?: string;
  /**
   * Pass `false` where the bubbles would outweigh one line of text. It drops
   * the icon and nothing else: a card inside another panel is `nested`, which
   * this is not.
   */
  icon?: boolean;
  /**
   * The card sits inside another panel: the dashed outline alone, with no fill
   * or bed shadow of its own. A card in a card that stands on the bed casts its
   * shadow onto the panel's own white (docs/design/pixel-craft.md, class 6).
   */
  nested?: boolean;
}) {
  const Heading = TITLE_TAG[titleAs];
  return (
    <div
      className={`rounded-panel border border-dashed border-border-strong ${
        nested ? "bg-transparent" : "bg-surface shadow-bed"
      } p-10 text-center${className ? ` ${className}` : ""}`}
    >
      {/* 28px: the bubbles fill their box, so this is 24px of ink with 2px of
          box above it, and the panel's top air matches its bottom air. */}
      {icon ? <DiveDayIcon name="empty" className="mx-auto mb-3 size-7 text-muted" /> : null}
      <Heading id={titleId} className="font-medium">
        {title}
      </Heading>
      {/* `text-pretty`: a centred body left "booking." alone on its last line. */}
      {body ? <p className="mx-auto mt-1 max-w-md text-pretty text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
