/** Ref callback: focus this field when it mounts, without scrolling the page. */
export function focusOnMount(element: HTMLElement | null) {
  element?.focus({ preventScroll: true });
}
