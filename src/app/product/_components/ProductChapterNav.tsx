"use client";

import { useEffect, useRef, useState } from "react";

type Chapter = { id: string; label: string; number: string };

/** Breathing room left beside the active chapter when the strip follows it. */
const FOLLOW_PADDING = 16;

/**
 * Where the strip has to sit for `item` to be readable — or `null` when it
 * already is, which is the common case and the one that must do nothing.
 *
 * Split out as arithmetic because that is the whole of the decision, and
 * because jsdom has no layout: a test can hand it real numbers where it could
 * never measure them.
 *
 * **Reveal, never centre.** Centring the active chapter is the obvious
 * instinct and it makes the strip lurch on every chapter change even when the
 * next item was already on screen. This moves the minimum, so a reader whose
 * chapters all fit sees the strip hold still.
 */
export function revealScrollLeft({
  scrollLeft,
  clientWidth,
  scrollWidth,
  boxLeft,
  boxRight,
  itemLeft,
  itemRight,
  pad = FOLLOW_PADDING,
}: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  boxLeft: number;
  boxRight: number;
  itemLeft: number;
  itemRight: number;
  pad?: number;
}): number | null {
  const furthest = Math.max(0, scrollWidth - clientWidth);
  const clamp = (value: number) => Math.max(0, Math.min(furthest, value));
  // Measured from the container's own edges, not `offsetLeft`: the strip is not
  // a positioned ancestor, so an item's `offsetLeft` is relative to something
  // else entirely and would scroll to the wrong place.
  const overLeft = itemLeft - (boxLeft + pad);
  const overRight = itemRight - (boxRight - pad);
  if (overLeft >= 0 && overRight <= 0) return null;
  // Off the left edge and off the right at once means the item is wider than
  // the strip; align its start, which is where its number and label begin.
  const next = clamp(scrollLeft + (overLeft < 0 ? overLeft : overRight));
  return next === scrollLeft ? null : next;
}

/**
 * The product page's day-at-a-glance strip follows the chapter in view. It is
 * still ordinary anchor navigation without JavaScript; the observer only adds
 * the active-time cue while someone scrolls through the story.
 */
export function ProductChapterNav({
  ariaLabel,
  title,
  chapters,
}: {
  ariaLabel: string;
  title: string;
  chapters: readonly Chapter[];
}) {
  const [activeId, setActiveId] = useState(chapters[0]?.id ?? "");
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sections = chapters
      .map((chapter) => document.getElementById(chapter.id))
      .filter((section): section is HTMLElement => Boolean(section));
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      // This central band follows the chapter a reader is actually in rather
      // than switching the cue the moment the next heading touches the fold.
      { rootMargin: "-20% 0px -55%" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [chapters]);

  /**
   * **Keep the marked chapter where the reader can see it.**
   *
   * The strip overflows a phone — five chapters plus the title, every one
   * `whitespace-nowrap shrink-0` — so by the third or fourth chapter the
   * highlight had scrolled off the right edge and a reader saw a strip of
   * names with no mark anywhere in it. The cue was working for somebody who
   * could not see it, which reads as a nav that has stopped tracking them.
   *
   * `scrollTo` on the strip, never `scrollIntoView`: this bar is
   * `sticky top-0`, and anything that can scroll the *page* vertically fights a
   * reader who is mid-scroll for control of their own viewport. A container's
   * own `scrollTo` cannot do that.
   *
   * Nothing happens while the active chapter is already visible, which is also
   * what stops the strip yanking itself back from a reader dragging it by hand.
   */
  useEffect(() => {
    const box = stripRef.current;
    const item = box?.querySelector<HTMLElement>(`[data-chapter="${activeId}"]`);
    if (!box || !item) return;
    const boxRect = box.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const next = revealScrollLeft({
      scrollLeft: box.scrollLeft,
      clientWidth: box.clientWidth,
      scrollWidth: box.scrollWidth,
      boxLeft: boxRect.left,
      boxRight: boxRect.right,
      itemLeft: itemRect.left,
      itemRight: itemRect.right,
    });
    if (next === null) return;
    // Reduced motion means the strip is simply already correct — it still
    // follows, it just does not glide there.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    box.scrollTo({ left: next, behavior: reduced ? "auto" : "smooth" });
  }, [activeId]);

  return (
    <nav
      aria-label={ariaLabel}
      className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm"
    >
      <div
        ref={stripRef}
        className="mx-auto flex max-w-6xl items-center gap-x-4 sm:gap-x-8 px-4 sm:px-6 py-1 text-sm overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <p className="shrink-0 py-2 text-xs sm:text-sm font-semibold tracking-tight">{title}</p>
        <ol className="flex items-center gap-x-2 sm:gap-x-8 shrink-0">
          {chapters.map((chapter) => {
            const active = chapter.id === activeId;
            return (
              <li key={chapter.id} className="shrink-0">
                <a
                  href={`#${chapter.id}`}
                  data-chapter={chapter.id}
                  aria-current={active ? "step" : undefined}
                  onClick={() => setActiveId(chapter.id)}
                  className={`flex min-h-11 items-center gap-1.5 sm:gap-2 border-b-2 px-1.5 sm:px-1 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted hover:text-foreground"
                  }`}
                >
                  <span className="text-[11px] sm:text-xs tabular-nums text-muted">
                    {chapter.number}
                  </span>
                  <span>{chapter.label}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
