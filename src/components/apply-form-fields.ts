import { isDraftableField } from "@/lib/form-drafts";

/**
 * Put values into a form's own controls the way a keystroke would.
 *
 * Shared by the form draft (ADR 20260906-before-you-ask, decision 3) and the
 * add panel's weekday pattern (same decision): each control's native value
 * setter plus an `input` event, so a React-managed control — a
 * `ForgivingInput` found by `data-draft-for`, a preview that reads a field —
 * sees the change the way it sees typing. Hidden, file and submit controls are
 * never touched, and neither is any field on the draft never-list.
 *
 * Returns true when at least one control took a value.
 */
export function applyFormFields(form: HTMLFormElement, fields: Record<string, string>): boolean {
  let applied = false;
  for (const [name, value] of Object.entries(fields)) {
    if (!isDraftableField(name)) continue;
    const selector = name.replace(/["\\]/g, "\\$&");
    const controls = [
      ...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        `[name="${selector}"], [data-draft-for="${selector}"]`,
      ),
    ];
    for (const control of controls) {
      if (control instanceof HTMLSelectElement) {
        if ([...control.options].some((option) => option.value === value)) {
          setNativeValue(control, value);
          applied = true;
        }
        continue;
      }
      if (control instanceof HTMLInputElement) {
        if (control.type === "hidden" || control.type === "file" || control.type === "submit") {
          continue;
        }
        if (control.type === "checkbox" || control.type === "radio") {
          const checked = value.split(" ").includes(control.value);
          if (control.checked !== checked) {
            control.click();
            applied = true;
          }
          continue;
        }
      }
      if (control.value !== value) {
        setNativeValue(control, value);
        applied = true;
      }
    }
  }
  return applied;
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
  );
}
