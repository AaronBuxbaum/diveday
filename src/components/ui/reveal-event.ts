/**
 * Dispatched (bubbling) on a control just before something outside it moves
 * the focus there — `FieldErrorFocus` for a refused save's `?field=` — so a
 * folded section around it (`EditorSection` on a phone) opens first.
 */
export const EDITOR_REVEAL_EVENT = "editor-reveal";
