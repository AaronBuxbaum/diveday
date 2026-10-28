/** Preserve an initial focus request made while staff content is covered. */
export function focusAfterStaffCheck(element: HTMLElement | null): () => void {
  if (!element) return () => {};
  let frame: number | undefined;
  const unlocked = () => {
    frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (
        element.isConnected &&
        !element.closest("[inert]") &&
        (active === document.body || active?.closest("[data-staff-session-lock]"))
      )
        element.focus({ preventScroll: true });
    });
  };
  document.addEventListener("staff-session-unlocked", unlocked, { once: true });
  if (!element.closest("[inert]")) element.focus({ preventScroll: true });
  return () => {
    document.removeEventListener("staff-session-unlocked", unlocked);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
