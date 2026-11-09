"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * The add panel's two behaviours that need a browser: it takes focus when it
 * opens, so a keyboard or screen-reader user lands in it rather than on the
 * link they pressed, and Escape shuts it the way its close link does.
 *
 * Focus goes to the panel's heading, not its first field: on a phone a field
 * would raise the keyboard over the form before anyone has read it. A field
 * inside the panel that already holds focus keeps it.
 */
export function AddPanelFocus({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // A retained hidden Activity can contain the same id. Own this DOM
    // instance rather than whichever panel document.getElementById finds first.
    const panel = anchor.current?.closest<HTMLElement>("[data-add-panel]");
    if (!panel) return;
    // Only a field inside the panel keeps focus. Anything else is the link
    // that opened it, which Next leaves focused inside the previous route's
    // hidden <Activity> tree after a client navigation.
    if (!panel.contains(document.activeElement)) {
      panel.querySelector<HTMLElement>("[data-add-panel-heading]")?.focus({ preventScroll: true });
      if (panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: "start" });
    }
    // This effect can move the page after the staff header hydrates. Publish
    // its own completion so a browser journey does not click coordinates that
    // this scroll is about to move (#4166). Preserved focus is settled too.
    panel.setAttribute("data-add-panel-settled", "");
    return () => panel.removeAttribute("data-add-panel-settled");
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // An open dialog or menu above the panel owns its own Escape.
      if (document.querySelector("dialog[open]")) return;
      const panel = anchor.current?.closest<HTMLElement>("[data-add-panel]");
      if (!panel?.contains(document.activeElement)) return;
      router.replace(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeHref, router]);

  return <span ref={anchor} hidden />;
}
