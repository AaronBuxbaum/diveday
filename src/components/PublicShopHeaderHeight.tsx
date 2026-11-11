"use client";

import { useEffect, useRef } from "react";

const HEIGHT_VAR = "--public-chrome-h";
const owners = new WeakMap<HTMLElement, { order: number }>();
let nextOwner = 0;

/**
 * Keep public sticky offsets beside the wrapping header, without sizing it from
 * its output. At very large text sizes, let the top scroll away until at least
 * half the viewport is available to the form (ADR 20260907-in-your-hands, 19d).
 */
export function PublicShopHeaderHeight() {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const header = probe.current?.closest("header");
    if (!header) return;
    const root = document.documentElement;
    const owner = { order: ++nextOwner };
    const release = () => {
      header.removeAttribute("data-chrome-measured");
      header.style.removeProperty("top");
      if (owners.get(root) !== owner) return;
      owners.delete(root);
      root.style.removeProperty(HEIGHT_VAR);
    };
    const write = () => {
      const height = header.getBoundingClientRect().height;
      if (height <= 0) {
        release();
        return;
      }
      const current = owners.get(root);
      if (current && current.order > owner.order) return;
      owners.set(root, owner);
      const viewport = Math.min(
        window.innerHeight,
        window.visualViewport?.height ?? window.innerHeight,
      );
      const clearance = Math.min(Math.ceil(height), Math.floor(viewport / 2));
      const top = `${Math.min(0, clearance - Math.ceil(height))}px`;
      if (header.style.top !== top) header.style.top = top;
      const value = `${clearance}px`;
      if (root.style.getPropertyValue(HEIGHT_VAR) !== value)
        root.style.setProperty(HEIGHT_VAR, value);
      header.setAttribute("data-chrome-measured", "true");
    };
    write();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(write);
    observer?.observe(header);
    window.addEventListener("resize", write);
    window.visualViewport?.addEventListener("resize", write);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", write);
      window.visualViewport?.removeEventListener("resize", write);
      release();
    };
  }, []);
  return <span ref={probe} hidden />;
}
