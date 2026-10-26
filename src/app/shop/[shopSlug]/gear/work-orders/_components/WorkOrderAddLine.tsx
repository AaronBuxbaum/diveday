// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { forgetKeptTyped, KeepTypedOnRefusal } from "@/components/KeepTypedOnRefusal";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { addWorkOrderLineAction } from "../actions";

const REFUSALS = new Set(["invalid-quantity", "invalid-amount", "empty-description", "invalid"]);

/** The existing add form opens locally; a refusal keeps the attempted figures. */
export function WorkOrderAddLine({
  notice,
  label,
  scope,
  children,
}: {
  notice?: string;
  label: string;
  scope: string;
  children: ReactNode;
}) {
  const door = useRef<HTMLDetailsElement>(null);
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
      <form action={addWorkOrderLineAction} className="mt-3 grid gap-4 sm:grid-cols-2">
        {children}
        <KeepTypedOnRefusal
          form="work-order-add-line"
          scope={scope}
          restore={Boolean(notice && REFUSALS.has(notice))}
        />
        <LineOutcome notice={notice} door={door} scope={scope} />
      </form>
    </details>
  );
}

/** Form completion, including the second result with exactly the same notice. */
function LineOutcome({
  notice,
  door,
  scope,
}: {
  notice?: string;
  door: RefObject<HTMLDetailsElement | null>;
  scope: string;
}) {
  const { pending } = useFormStatus();
  useEffect(() => {
    if (pending) return;
    if (notice === "line-added") {
      forgetKeptTyped("work-order-add-line", scope);
      if (door.current) door.current.open = false;
      document.getElementById("work-order-total")?.focus({ preventScroll: true });
    }
  }, [notice, pending, door, scope]);
  return null;
}
