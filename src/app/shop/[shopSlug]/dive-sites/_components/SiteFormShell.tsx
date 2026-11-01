"use client";

import type { ReactNode } from "react";
import { useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { FormStatus, StickyFormActions } from "@/components/ui/form";
import type { DiveSiteFormError, SubmittedFormValues } from "@/lib/dive-sites";
import { SITE_FORM_REFUSAL_SECTION } from "./site-form-sections";

/**
 * Every refusal the briefing's one Save can come back with: the briefing's own
 * rules, and the two its Spanish boxes add now that the same Save writes them
 * (visual review 2026-10-24, A11).
 */
export type SiteSaveRefusal = DiveSiteFormError | "spanishStale" | "spanishRefused";

/**
 * What a refused site briefing hands back to the form: a code for the rule that
 * refused it, never a sentence, plus everything that was typed. Success never
 * returns — it redirects to the saved site.
 */
export type SiteFormState = {
  errorCode?: SiteSaveRefusal;
  values?: SubmittedFormValues;
};

export const IDLE_SITE_FORM_STATE: SiteFormState = {};

export type SiteFormAction = (state: SiteFormState, formData: FormData) => Promise<SiteFormState>;

/** Put one submitted value back on the control it came from. */
function restore(field: Element, values: SubmittedFormValues) {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    // A checkbox posts only when checked, so absence *is* the value: an
    // unchecked box has to come back unchecked, not left as the page rendered
    // it. `field.value` is "on" for a box with no value attribute of its own.
    field.checked = (values[field.name] ?? []).includes(field.value);
    return;
  }
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    field.value = values[field.name]?.[0] ?? "";
  }
}

/**
 * Keep server-rendered fields uncontrolled and pass translated messages in.
 * A refusal returns values for restoration after React resets the form, so
 * staff keep their draft without moving field copy into the client bundle.
 */
export function SiteFormShell({
  action,
  errorMessages,
  savedMessage,
  actions,
  children,
}: {
  action: SiteFormAction;
  /** One already-translated sentence per refusal code the action can return. */
  errorMessages: Record<SiteSaveRefusal, string>;
  /**
   * The confirmation for a save that *did* land, already translated. A
   * successful save redirects (that is how the URL stops being a stale draft),
   * so this arrives as a `?notice=` the page resolved — but it belongs in the
   * same place as the refusal, at the end of the form, rather than in a banner
   * the length of the briefing away from the button that earned it.
   */
  savedMessage?: string;
  /**
   * The one Save, and the sentence naming what is unsaved. They ride the
   * bottom of the viewport with the refusal, because this form is ten sections
   * and some four thousand pixels tall and a button at the far end of that is
   * a button nobody can find (ADR 20260827-the-shops-shelves, the long-form
   * editor pattern: "one sticky Save with the unsaved-changes note, refusals
   * landing field-side as they do today").
   */
  actions?: ReactNode;
  children: ReactNode;
}) {
  // A new key retriggers focus when the same refusal is returned twice;
  // useActionState provides no attempt id, so the shell adds one locally.
  const [state, formAction] = useActionState<SiteFormState & { attempt?: number }, FormData>(
    async (previous, formData) => ({
      ...(await action(previous, formData)),
      attempt: (previous.attempt ?? 0) + 1,
    }),
    IDLE_SITE_FORM_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form || !state.values) return;
    for (const field of Array.from(form.elements)) restore(field, state.values);
    // A refusal about a closed section opens it, so the field to fix is not
    // behind a shut disclosure beside the sentence that names it.
    const section = state.errorCode ? SITE_FORM_REFUSAL_SECTION[state.errorCode] : undefined;
    const details = section ? document.getElementById(section) : null;
    if (details instanceof HTMLDetailsElement) details.open = true;
  }, [state]);

  // Set once React owns the form. A field edited while the server-rendered
  // markup is still being hydrated can lose the edit's selection half-way (a
  // cleared note saved as itself minus its first letter, CI 2026-10-12), so
  // the e2e suite waits on this before it types, never on a timer.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-6"
      data-hydrated={hydrated ? "true" : undefined}
    >
      {children}
      {/* Keep refusal beside Save and the unsaved note in the sticky action
          row (ADR 20260827-the-shops-shelves). Shared status and focus helpers
          provide the danger treatment, scrolling, and focus ring. */}
      <StickyFormActions>
        {actions}
        {state.errorCode ? (
          <>
            <FormStatus tone="danger" id={REFUSAL_ID}>
              {errorMessages[state.errorCode]}
            </FormStatus>
            <FieldErrorFocus key={state.attempt} field={REFUSAL_ID} />
          </>
        ) : savedMessage ? (
          <FormStatus tone="success">{savedMessage}</FormStatus>
        ) : null}
      </StickyFormActions>
    </form>
  );
}

/**
 * The refusal line's own id, so `FieldErrorFocus` has something to name. The
 * two site forms are never on one page together, so one constant is enough.
 */
const REFUSAL_ID = "site-form-refusal";
