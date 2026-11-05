import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { BUTTON_RADIUS } from "@/components/ui/button";

/**
 * **A loading face is the page's own primitives, pending** (ADR
 * 20261104-loading-face-is-the-primitives-pending-face, issue #2769).
 *
 * This file is the one place the two skeleton literals are spelled: the pulse
 * (`animate-pulse`) and the bar's fill (`bg-surface-sunken`). Every primitive
 * with a resting shape draws its pending face through these two —
 * `<ShopPageHeader pending>`, `<SectionCard pending>`, `<ShopStat pending>` —
 * and a route's `loading.tsx` composes those, plus `Bone` for a line of words
 * whose width only the page knows. `check-loading-skeletons.mjs` fails on
 * either literal in a `loading.tsx`, so a skeleton cannot hand-type a bar that
 * drifts from the shape it stands for (#1857).
 */
const PULSE = "animate-pulse";
const FILL = "bg-surface-sunken";

/**
 * **A bone's corner is the corner of the thing it stands for**, read off that
 * thing's own class string rather than typed at the call site:
 *
 * - `line` — a line of words: a heading, a sentence, a label (`rounded`).
 * - `control` — a button or a field: the control rung every button takes
 *   (`buttonClass`'s `rounded` shape, which `controlClass` shares).
 * - `pill` — a filter chip, a round mark, an avatar: `buttonClass`'s `pill`.
 * - `inset` — a sunken inset tile or note (`rounded-inset`).
 * - `panel` — a block the size of a card, a photo or a map (`rounded-panel`).
 * - `media` — the dive-site map's frame (`rounded-xl`).
 * - `bleed` — an edge-to-edge image with no corner at all.
 */
export const BONE_SHAPE = {
  line: "rounded",
  control: BUTTON_RADIUS.rounded,
  pill: BUTTON_RADIUS.pill,
  inset: "rounded-inset",
  panel: "rounded-panel",
  media: "rounded-xl",
  bleed: "",
} as const;

export type BoneShape = keyof typeof BONE_SHAPE;

/** The bar's class string: its geometry from the caller, its corner from `shape`, its fill from here. */
export function boneClass(shape: BoneShape = "line", className = ""): string {
  return `${className} ${BONE_SHAPE[shape]} ${FILL}`.replace(/\s+/g, " ").trim();
}

type Polymorphic<T extends ElementType, Own> = Own & { as?: T } & Omit<
    ComponentPropsWithoutRef<T>,
    keyof Own | "as"
  >;

/**
 * One placeholder bar. Its height and width are the caller's — the line box
 * and rough length of the words it stands for (`h-lh` inside the text's own
 * type classes reads the line box exactly) — and its corner and fill are this
 * primitive's. It renders a `div` unless `as` says otherwise (`span` inside a
 * phrasing parent, `li` as a list's row).
 */
export function Bone<T extends ElementType = "div">({
  as,
  shape = "line",
  className = "",
  ...rest
}: Polymorphic<T, { shape?: BoneShape; className?: string }>) {
  const Tag: ElementType = as ?? "div";
  return <Tag {...rest} className={boneClass(shape, className)} />;
}

/**
 * The pulse a loading face breathes with: one wrapper round the bars and
 * pending shells it holds. It renders a `div` unless `as` says otherwise (a
 * marketing page's `<main>`), and takes the layout classes of the element it
 * replaces.
 */
export function Pending<T extends ElementType = "div">({
  as,
  className = "",
  children,
  ...rest
}: Polymorphic<T, { className?: string; children?: ReactNode }>) {
  const Tag: ElementType = as ?? "div";
  return (
    <Tag {...rest} className={`${PULSE} ${className}`.trim()}>
      {children}
    </Tag>
  );
}
