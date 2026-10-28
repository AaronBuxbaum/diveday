"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";

/**
 * **Ask in plain words, land on a view** (the `search` assist). The answer is
 * a URL the page could have built from its own controls, so the result is the
 * ordinary list with its ordinary chips showing what was applied, and the
 * staffer changes it the usual way. An answer that maps to nothing leaves the
 * page as it was and says so.
 */
export function AssistAskForm({
  ask,
  label,
  placeholder,
  submitLabel,
  pendingLabel,
  noAnswer,
  maxLength,
}: {
  ask: (text: string) => Promise<string | null>;
  label: string;
  placeholder: string;
  submitLabel: string;
  pendingLabel: string;
  noAnswer: string;
  maxLength: number;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [missed, setMissed] = useState(false);

  function submit(formData: FormData) {
    const text = String(formData.get("ask") ?? "").trim();
    if (!text) return;
    setMissed(false);
    startTransition(async () => {
      let href: string | null = null;
      try {
        href = await ask(text);
      } catch {
        href = null;
      }
      if (href) router.push(href);
      else setMissed(true);
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <input
          id={id}
          name="ask"
          maxLength={maxLength}
          placeholder={placeholder}
          className={`${controlClass} mt-1`}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className={buttonClass({ variant: "secondary", busy: pending })}
      >
        {pending ? pendingLabel : submitLabel}
      </button>
      <p aria-live="polite" className="text-sm text-muted empty:hidden sm:basis-full">
        {missed ? noAnswer : null}
      </p>
    </form>
  );
}
