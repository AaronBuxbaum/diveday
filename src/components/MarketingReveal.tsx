"use client";

import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

type RevealState = "ready" | "pending" | "visible";

/**
 * A below-the-fold marketing section may enter gently once, but the first
 * screen must be useful before JavaScript has run. The server therefore sends
 * the section in its normal visible state; only a section whose measured top
 * is below the viewport is hidden, and only until its first intersection.
 */
export function MarketingReveal({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RevealState>("ready");

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (element.getBoundingClientRect().top <= window.innerHeight) return;

    setState("pending");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setState("visible");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={elementRef}
      className={`marketing-reveal marketing-reveal-${state} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

/** Gives the first-screen roll-call mockup one calm arrival and a tiny row settle. */
export function MarketingHeroMotion({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);

  useLayoutEffect(() => {
    setActive(true);
  }, []);

  return (
    <div
      className={
        active ? "marketing-hero-motion marketing-hero-motion-active" : "marketing-hero-motion"
      }
    >
      {children}
    </div>
  );
}

/** Applies the same one-time reveal to native `<section>` elements on a marketing page. */
export function MarketingSectionMotion() {
  useLayoutEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>("main section")];
    const pending = sections.filter(
      (section) => section.getBoundingClientRect().top > window.innerHeight,
    );
    if (pending.length === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;

    for (const section of pending) section.classList.add("marketing-reveal-pending");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const section = entry.target as HTMLElement;
          section.classList.remove("marketing-reveal-pending");
          section.classList.add("marketing-reveal-visible");
          observer.unobserve(section);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
    for (const section of pending) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return null;
}
