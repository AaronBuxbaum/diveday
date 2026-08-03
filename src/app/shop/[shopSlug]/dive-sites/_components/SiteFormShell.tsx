"use client";

import type { ReactNode } from "react";
import { useActionState, useLayoutEffect, useRef } from "react";
import { ShopNotice } from "@/components/ShopPageHeader";
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
  children,
}: {
  action: SiteFormAction;
  /** One already-translated sentence per refusal code the action can return. */
  errorMessages: Record<DiveSiteFormError, string>;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState(action, IDLE_SITE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form || !state.values) return;
    for (const field of Array.from(form.elements)) restore(field, state.values);
  }, [state]);

  return (
    <>
      {state.errorCode ? (
        <ShopNotice tone="danger" role="alert" className="mt-6">
          {errorMessages[state.errorCode]}
        </ShopNotice>
      ) : null}
      <form ref={formRef} action={formAction} className="mt-8 flex flex-col gap-5">
        {children}
      </form>
    </>
  );
}
