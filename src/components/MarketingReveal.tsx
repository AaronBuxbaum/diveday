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
  const elementRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setActive(true);
      return;
    }
    if (element.getBoundingClientRect().top <= window.innerHeight) {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setActive(true);
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
      className={
        active ? "marketing-hero-motion marketing-hero-motion-active" : "marketing-hero-motion"
      }
    >
      {children}
    </div>
  );
}

/**
 * The attribute this component sets on `<html>` once it has decided which
 * sections to withhold — including the branches that withhold none.
 *
 * **A reader never needs it; the camera does.** The withholding happens in a
 * layout effect, so it cannot happen before hydration, and anything that wants
 * to know whether a page is finished hiding things has otherwise only a guess
 * about when React got there. `e2e/visual.spec.ts` waits for this before its
 * scroll-through, which is the pass that reveals the sections again — without
 * it the two race, and the race is what put a hero, nine thousand blank pixels
 * and a footer into the `product-dark-vw-390` baseline (issue #1910).
 *
 * Same contract as `ScrollToHash`'s `data-hash-landed` and
 * `PreserveFormScroll`'s `SCROLL_SETTLED_ATTRIBUTE`: set in **every** branch
 * the effect can return through, so a reader waiting on it is never left
 * waiting by the case that had nothing to do.
 */
export const REVEAL_READY_ATTRIBUTE = "data-marketing-reveal-ready";

/**
 * The marker in the server HTML that says this page runs the reveal at all.
 *
 * It has to be server-rendered, because its whole job is to be readable
 * *before* hydration: that is what lets the camera tell "this page will decide
 * something" from "this page has nothing to decide" without waiting on a
 * signal that is never coming. Every other page in the app carries neither the
 * marker nor the stamp and pays one `querySelector` for the distinction.
 */
export const REVEAL_MARKER_ATTRIBUTE = "data-marketing-reveal";

/** Applies the same one-time reveal to native `<section>` elements on a marketing page. */
export function MarketingSectionMotion() {
  useLayoutEffect(() => {
    // Stamped first and unconditionally: every branch below is a decision, and
    // the ones that decide to withhold nothing are decisions too.
    const landed = () => document.documentElement.setAttribute(REVEAL_READY_ATTRIBUTE, "");
    const sections = [...document.querySelectorAll<HTMLElement>("main section")];
    const pending = sections.filter(
      (section) => section.getBoundingClientRect().top > window.innerHeight,
    );
    if (pending.length === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      landed();
      return;
    }

    for (const section of pending) section.classList.add("marketing-reveal-pending");
    landed();
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

  // A marker rather than `null`, so a camera can tell a page that will withhold
  // something from one that simply has no reveal on it — see
  // `REVEAL_MARKER_ATTRIBUTE`. `hidden` keeps it out of layout and out of the
  // accessibility tree.
  return <span hidden {...{ [REVEAL_MARKER_ATTRIBUTE]: "" }} />;
}
