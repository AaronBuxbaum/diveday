"use client";

import { useEffect, useRef } from "react";

const HEIGHT_VAR = "--public-chrome-h";
const owners = new WeakMap<HTMLElement, { order: number }>();
let nextOwner = 0;

/** Keep public sticky offsets beside the wrapping header, without sizing that header from its output. */
export function PublicShopHeaderHeight() {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const header = probe.current?.closest("header");
    if (!header) return;
    const root = document.documentElement;
    const owner = { order: ++nextOwner };
    const release = () => {
      header.removeAttribute("data-chrome-measured");
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
      const value = `${Math.ceil(height)}px`;
      if (root.style.getPropertyValue(HEIGHT_VAR) !== value)
        root.style.setProperty(HEIGHT_VAR, value);
      header.setAttribute("data-chrome-measured", "true");
    };
    write();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(write);
    observer?.observe(header);
    return () => {
      observer?.disconnect();
      release();
    };
  }, []);
  return <span ref={probe} hidden />;
}
