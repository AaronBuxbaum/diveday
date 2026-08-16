"use client";

import { useEffect, useState } from "react";

type Chapter = { id: string; label: string; number: string };

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

  return (
    <nav
      aria-label={ariaLabel}
      className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-8 px-6 py-2 text-sm">
        <p className="py-2.5 font-semibold">{title}</p>
        <ol className="grid grid-cols-[auto_1fr] gap-x-4 sm:flex sm:flex-wrap sm:gap-x-8">
          {chapters.map((chapter) => {
            const active = chapter.id === activeId;
            return (
              <li key={chapter.id}>
                <a
                  href={`#${chapter.id}`}
                  aria-current={active ? "step" : undefined}
                  onClick={() => setActiveId(chapter.id)}
                  className={`flex min-h-11 items-center gap-2 border-b-2 px-1 font-medium transition-colors ${
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted hover:text-foreground"
                  }`}
                >
                  <span className="text-xs tabular-nums">{chapter.number}</span>
                  {chapter.label}
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
