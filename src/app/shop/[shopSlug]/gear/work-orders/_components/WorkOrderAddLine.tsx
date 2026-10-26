// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { addWorkOrderLineAction } from "../actions";

const REFUSALS = new Set(["invalid-quantity", "invalid-amount", "empty-description", "invalid"]);

/** The existing add form opens locally; a refusal keeps the attempted figures. */
export function WorkOrderAddLine({
  notice,
  label,
  children,
}: {
  notice?: string;
  label: string;
  children: ReactNode;
}) {
  const door = useRef<HTMLDetailsElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const attempted = useRef<FormData | null>(null);
  return (
    <details
      ref={door}
      open={notice && REFUSALS.has(notice) ? true : undefined}
      className="group mt-4 border-t border-border pt-3"
    >
      <summary
        className={buttonClass({
          variant: "link",
          flush: true,
          className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {label}
        <DisclosureCaret direction="down" className="group-open:rotate-180" />
      </summary>
      <form
        ref={form}
        action={addWorkOrderLineAction}
        onSubmit={(event) => {
          attempted.current = new FormData(event.currentTarget);
        }}
        className="mt-3 grid gap-4 sm:grid-cols-2"
      >
        {children}
        <LineOutcome notice={notice} door={door} form={form} attempted={attempted} />
      </form>
    </details>
  );
}

/** Form completion, including the second result with exactly the same notice. */
function LineOutcome({
  notice,
  door,
  form,
  attempted,
}: {
  notice?: string;
  door: RefObject<HTMLDetailsElement | null>;
  form: RefObject<HTMLFormElement | null>;
  attempted: RefObject<FormData | null>;
}) {
  const { pending } = useFormStatus();
  useEffect(() => {
    if (pending) return;
    if (notice === "line-added") {
      attempted.current = null;
      if (door.current) door.current.open = false;
      document.getElementById("work-order-total")?.focus({ preventScroll: true });
    } else if (notice && REFUSALS.has(notice) && form.current) {
      if (door.current) door.current.open = true;
      for (const field of Array.from(form.current.elements)) {
        if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) continue;
        const value = attempted.current?.get(field.name);
        if (typeof value === "string") field.value = value;
      }
    }
  }, [notice, pending, door, form, attempted]);
  return null;
}
