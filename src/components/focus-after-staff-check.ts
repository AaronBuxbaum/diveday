/** Preserve an initial focus request made while staff content is covered. */
export function focusAfterStaffCheck(element: HTMLElement | null): () => void {
  if (!element) return () => {};
  const pendingCheck = document.querySelector('[data-staff-session-check="pending"]');
  let frame: number | undefined;
  let observer: MutationObserver | undefined;
  const unlocked = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const active = document.activeElement;
      if (
        element.isConnected &&
        !element.closest("[inert]") &&
        (active === document.body ||
          active?.closest("[data-staff-session-root], [data-staff-session-lock]"))
      )
        element.focus({ preventScroll: true });
    });
  };
  document.addEventListener("staff-session-unlocked", unlocked, { once: true });
  if (pendingCheck) {
    // A streamed client component can mount after the unlock event but before
    // React updates this marker. Watch the marker too, so its focus request is
    // not lost in that gap.
    observer = new MutationObserver(() => {
      if (pendingCheck.getAttribute("data-staff-session-check") === "pending") return;
      observer?.disconnect();
      unlocked();
    });
    observer.observe(pendingCheck, {
      attributes: true,
      attributeFilter: ["data-staff-session-check"],
    });
  } else if (!element.closest("[inert]")) {
    element.focus({ preventScroll: true });
  }
  return () => {
    document.removeEventListener("staff-session-unlocked", unlocked);
    observer?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
