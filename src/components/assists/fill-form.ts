/**
 * Puts assist answers into a form the way a person filling it would: an input
 * or a textarea through its native setter and an `input` event, a select only
 * to an option it already offers, with a `change` event. A key that starts with
 * `#` names an element by id anywhere on the page (the Spanish box beside a
 * description lives in its own form); every other key is a field name in
 * `form`. A disabled, read-only or missing field is left alone.
 */
export function fillFormFields(
  form: HTMLFormElement | null,
  values: Record<string, string>,
): number {
  let filled = 0;
  for (const [key, value] of Object.entries(values)) {
    const field = key.startsWith("#")
      ? document.getElementById(key.slice(1))
      : (form?.elements.namedItem(key) ?? null);
    if (fillOne(field, value)) filled += 1;
  }
  return filled;
}

function fillOne(field: Element | RadioNodeList | null, value: string): boolean {
  if (field instanceof HTMLSelectElement) {
    if (field.disabled || ![...field.options].some((option) => option.value === value))
      return false;
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) return false;
  if (field.disabled || field.readOnly || field.type === "hidden" || field.type === "file")
    return false;
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/**
 * The form's text values, files left out: what an assist reads of a form not
 * yet saved. A repeated name (a group of checkboxes) is joined with commas.
 */
export function formTextValues(form: HTMLFormElement | null): Record<string, string> {
  if (!form) return {};
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form)) {
    if (typeof value !== "string") continue;
    values[key] = key in values ? `${values[key]},${value}` : value;
  }
  return values;
}
