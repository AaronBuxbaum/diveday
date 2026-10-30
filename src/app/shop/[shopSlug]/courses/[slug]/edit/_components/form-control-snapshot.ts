/** One named control's state, addressed by name and position. */
export type FormControlSnapshot = {
  name: string;
  index: number;
  value: string;
  checked: boolean;
};

/** Capture every named, restorable control in document order. */
export function snapshotFormControls(form: HTMLFormElement): FormControlSnapshot[] {
  const seen = new Map<string, number>();
  const out: FormControlSnapshot[] = [];
  for (const element of Array.from(form.elements)) {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (!field.name) continue;
    // File values cannot be assigned during restoration, so the writer picks them again.
    if (field instanceof HTMLInputElement && field.type === "file") continue;
    const index = seen.get(field.name) ?? 0;
    seen.set(field.name, index + 1);
    out.push({
      name: field.name,
      index,
      value: field.value,
      checked: field instanceof HTMLInputElement ? field.checked : false,
    });
  }
  return out;
}
