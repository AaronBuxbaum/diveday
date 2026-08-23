"use client";

import { useActionState, useEffect, useRef } from "react";
import { ShopNotice } from "@/components/ShopPageHeader";

export type SaveResult = { ok: false; reason: "conflict" } | null;

/** One control's state as the writer left it, addressed by name and position. */
type Typed = { name: string; index: number; value: string; checked: boolean };

/** Every named control in the form, in document order, with what it holds. */
function snapshot(form: HTMLFormElement): Typed[] {
  const seen = new Map<string, number>();
  const out: Typed[] = [];
  for (const element of Array.from(form.elements)) {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (!field.name) continue;
    // A file input's value cannot be assigned, so restoring one is impossible
    // rather than merely awkward. The writer re-picks the photo; every word
    // they typed survives, which is the part that took an afternoon.
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

/**
 * **The form, and the one refusal that must not cost the writer their work.**
 *
 * This editor posts its *whole* page — nine sections, pricing, photos, the
 * day-by-day plan, the FAQ — so two people with it open do not overwrite one
 * field between them: the second save reverts every section to whatever the row
 * held when that tab opened. It used to do that silently, and the first
 * writer's work was gone with no record it had existed (issue #820).
 *
 * The save is refused now, and the refusal has to leave the typed text on
 * screen — otherwise the message announcing that nothing was lost is itself
 * what loses it.
 *
 * **Returning instead of redirecting is not enough, which I found out by
 * measuring.** Next re-renders the server tree after *any* server action, so
 * the fields are replaced and each one snaps back to its `defaultValue` from
 * the database — the same outcome as the redirect, one step later. So the
 * values are snapshotted from the DOM at submit and written back when the save
 * comes back refused.
 *
 * **It does not merge.** Resolution is a merge UI and this does not need one:
 * the honest options are "copy what you changed, then reload" and "reload and
 * start again", and both need the text to still be there.
 */
export function ConflictGuardedForm({
  action,
  conflictMessage,
  reloadLabel,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<SaveResult>;
  conflictMessage: string;
  reloadLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const typed = useRef<Typed[] | null>(null);
  const [result, formAction] = useActionState<SaveResult, FormData>(
    async (_previous, formData) => action(formData),
    null,
  );

  useEffect(() => {
    if (result?.reason !== "conflict") return;
    const form = formRef.current;
    const saved = typed.current;
    if (!form || !saved) return;
    // Addressed by name *and* position, because a repeated name is how the
    // day-by-day plan and the FAQ are posted — restoring by name alone would
    // put every day's title in the first day's box.
    const seen = new Map<string, number>();
    for (const element of Array.from(form.elements)) {
      const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (!field.name) continue;
      if (field instanceof HTMLInputElement && field.type === "file") continue;
      const index = seen.get(field.name) ?? 0;
      seen.set(field.name, index + 1);
      const was = saved.find((item) => item.name === field.name && item.index === index);
      if (!was) continue;
      if (
        field instanceof HTMLInputElement &&
        (field.type === "checkbox" || field.type === "radio")
      )
        field.checked = was.checked;
      else field.value = was.value;
    }
  }, [result]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(event) => {
        typed.current = snapshot(event.currentTarget);
      }}
      className={className}
    >
      {/* Always rendered, empty or not: a slot that comes and goes shifts every
          sibling's position, and React reconciles a keyless list by index. */}
      <div aria-live="polite">
        {result?.reason === "conflict" ? (
          // `role="alert"` because the writer's eyes are on the field they were
          // typing in, and this is the one thing that changed. At the top of
          // the form rather than beside a field: nothing here belongs to one
          // input.
          <ShopNotice tone="warning" role="alert">
            {conflictMessage}{" "}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-medium text-primary underline underline-offset-2"
            >
              {reloadLabel}
            </button>
          </ShopNotice>
        ) : null}
      </div>
      {children}
    </form>
  );
}
