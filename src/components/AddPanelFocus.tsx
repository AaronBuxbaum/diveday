"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The add panel's two behaviours that need a browser: it takes focus when it
 * opens, so a keyboard or screen-reader user lands in it rather than on the
 * link they pressed, and Escape shuts it the way its close link does.
 *
 * Focus goes to the panel's heading, not its first field: on a phone a field
 * would raise the keyboard over the form before anyone has read it. A field
 * that already holds focus (a refusal's `FieldErrorFocus`, which mounts after
 * this) keeps it.
 */
export function AddPanelFocus({ panelId, closeHref }: { panelId: string; closeHref: string }) {
  const router = useRouter();

  useEffect(() => {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    panel.querySelector<HTMLElement>("[data-add-panel-heading]")?.focus({ preventScroll: true });
    if (panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: "start" });
  }, [panelId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // An open dialog or menu above the panel owns its own Escape.
      if (document.querySelector("dialog[open]")) return;
      const panel = document.getElementById(panelId);
      if (!panel?.contains(document.activeElement)) return;
      router.replace(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelId, closeHref, router]);

  return null;
}
