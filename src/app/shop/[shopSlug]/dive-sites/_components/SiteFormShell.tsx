"use client";

import type { ReactNode } from "react";
import { useActionState, useLayoutEffect, useRef } from "react";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { FormStatus } from "@/components/ui/form";
import type { DiveSiteFormError, SubmittedFormValues } from "@/lib/dive-sites";

/**
 * What a refused site briefing hands back to the form: a code for the rule that
 * refused it, never a sentence, plus everything that was typed. Success never
 * returns — it redirects to the saved site.
 */
export type SiteFormState = {
  errorCode?: DiveSiteFormError;
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
 * The `<form>` both site briefings live in.
 *
 * A rejected submission used to `redirect(?error=...)`, which re-rendered a
 * twenty-field form completely blank — the staffer's whole briefing gone, and
 * a banner naming rules that had not failed ("check the required name and
 * links", when the real refusal was the both-coordinates-or-neither rule).
 * Handing the refusal back through `useActionState` instead means React never
 * navigates, so the banner can name the one rule that actually refused the
 * save. Same shape as the diver booking form
 * (`src/app/s/[shopSlug]/trips/[id]/actions.ts`), which fixed the same bug for
 * a whole booking party.
 *
 * Not navigating is only half of it: React empties an uncontrolled form as soon
 * as its action settles, so staying on the page is not by itself enough to keep
 * what was typed. The refusal therefore carries the submission back with it and
 * this puts it straight back on the controls, in a layout effect — after
 * React's reset, before the browser paints, so there is no flash of an empty
 * form. The alternative, making all twenty fields controlled, would drag every
 * label into the client bundle; staff copy is resolved server-side (AGENTS.md:
 * staff Client Components take words as props), which is why the fields arrive
 * as server-rendered `children` and `errorMessages` arrives already translated.
 */
export function SiteFormShell({
  action,
  errorMessages,
  savedMessage,
  children,
}: {
  action: SiteFormAction;
  /** One already-translated sentence per refusal code the action can return. */
  errorMessages: Record<DiveSiteFormError, string>;
  /**
   * The confirmation for a save that *did* land, already translated. A
   * successful save redirects (that is how the URL stops being a stale draft),
   * so this arrives as a `?notice=` the page resolved — but it belongs in the
   * same place as the refusal, at the end of the form, rather than in a banner
   * the length of the briefing away from the button that earned it.
   */
  savedMessage?: string;
  children: ReactNode;
}) {
  // The attempt counter is what `FieldErrorFocus` is keyed on. Its effect is
  // keyed on what it was told, so the *same* refusal twice in a row — a
  // staffer who fixes the wrong coordinate and presses Save again — would
  // otherwise leave the cursor where it was. `useActionState` hands back a
  // fresh state object per attempt but no nonce, so wrapping the action is
  // where one comes from; the shell's own state type carries it and the
  // server action never sees it.
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
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="mt-8 flex flex-col gap-5">
      {children}
      {/* The refusal used to render *above* the form. On a twenty-field
          briefing that put it a full screen above the Save button the staffer
          had just pressed — they saw nothing happen, and scrolling back up was
          on them. It renders at the end of the form now, immediately after the
          submit button that is this form's last child.

          `FormStatus` is the shared shape for that (components/ui/form.tsx),
          and it brings the ❌ glyph a danger banner carried but a bare
          paragraph did not; `FieldErrorFocus` is the shared scroll-and-focus
          that this file used to re-implement with its own effect, ref and
          `tabIndex={-1}`. Between them the hand-rolled half of this component
          is gone — and the focus target picks up the brief ring the rest of the
          app's refusals already have. */}
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
    </form>
  );
}

/**
 * The refusal line's own id, so `FieldErrorFocus` has something to name. The
 * two site forms are never on one page together, so one constant is enough.
 */
const REFUSAL_ID = "site-form-refusal";
