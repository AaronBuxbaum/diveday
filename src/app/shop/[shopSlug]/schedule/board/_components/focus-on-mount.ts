/**
 * Moves focus into a panel's first field the moment it mounts. Every panel
 * here is conditionally rendered (not just hidden), so this ref callback
 * fires exactly once per open — biome's `noAutofocus` blocks the JSX
 * `autoFocus` attribute outright (it can't tell a page-load autofocus from
 * this one, which only ever runs in direct response to the staff member's
 * own click on the toggle that revealed the panel).
 */
export function focusOnMount(el: HTMLElement | null) {
  el?.focus();
}
