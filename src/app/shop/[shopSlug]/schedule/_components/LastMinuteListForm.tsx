"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { joinLastMinuteListAction, type LastMinuteListFormState } from "../actions";

const INITIAL_STATE: LastMinuteListFormState = {};

/**
 * The shop-wide "tell me about last-minute deals" opt-in — separate from the
 * per-trip wait list, which only appears on a full trip's own page (docs ADR
 * 20260727-last-minute-fill-promos). Lives on the schedule list, not any one
 * trip, since it isn't about a specific departure.
 */
export function LastMinuteListForm({ shopSlug }: { shopSlug: string }) {
  const [state, formAction] = useActionState(
    joinLastMinuteListAction.bind(null, shopSlug),
    INITIAL_STATE,
  );

  if (state.success) {
    return (
      <section className="rise-in mt-10 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-semibold">You're on the list.</h2>
        <p className="mt-1 text-sm text-muted">
          We'll email you if a discounted last-minute spot opens up in your dates.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10 rounded-2xl border border-border bg-surface p-6">
      <h2 className="font-semibold">Want a deal on a last-minute spot?</h2>
      <p className="mt-1 text-sm text-muted">
        Tell us when you're around and we'll email you if a boat needs to fill seats at a discount.
      </p>
      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <FieldGrid columns={2}>
          <Field label="Name">
            <input
              name="fullName"
              required
              maxLength={120}
              autoComplete="name"
              className={controlClass}
            />
          </Field>
          <Field label="Email">
            <input
              name="email"
              type="email"
              required
              maxLength={200}
              inputMode="email"
              autoComplete="email"
              className={controlClass}
            />
          </Field>
          <Field label="Phone" hint="(optional)">
            <input
              name="phone"
              type="tel"
              maxLength={30}
              autoComplete="tel"
              className={controlClass}
            />
          </Field>
          <div />
          <Field label="Around from" hint="(optional)">
            <input name="availableFrom" type="date" className={controlClass} />
          </Field>
          <Field label="Around until" hint="(optional)">
            <input name="availableUntil" type="date" className={controlClass} />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel="Joining…"
            className={buttonClass({ variant: "secondary", className: "px-5 py-2.5" })}
          >
            Notify me
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
