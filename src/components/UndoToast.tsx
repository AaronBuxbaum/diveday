"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * A land-then-undo toast: the action already happened, and this offers a few
 * seconds to take it back — the delight-first alternative to a blocking
 * "are you sure?" for reversible staff actions (docs delight backlog). It is
 * driven by the redirect that carries the undo target in the URL, auto-dismisses
 * after a beat, and its Undo submits a bound server action. Deliberately generic:
 * pass any inverse action plus the hidden fields it needs.
 */
export function UndoToast({
  message,
  action,
  fields,
  autoDismissMs = 8000,
}: {
  message: string;
  action: (formData: FormData) => void;
  fields: Record<string, string>;
  autoDismissMs?: number;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs]);
  if (!visible) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 print:hidden">
      <div
        role="status"
        className="rise-in flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-2xl"
      >
        <span className="text-sm font-medium">{message}</span>
        <form action={action}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <SubmitButton
            pendingLabel="Undoing…"
            className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            Undo
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
