"use client";

import { useEffect, useRef, useState } from "react";

/** Fills `{placeholder}` tokens in a server-supplied template with per-render values. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * A sticky "N of M answered" bar over the medical questionnaire — a dock, on
 * a phone, mid-scroll has no other way to see how much is left before the
 * signature at the bottom.
 *
 * Pure progressive enhancement: this wraps the server-rendered
 * `RadioQuestion` fieldsets as `children` without changing their markup, so
 * with JavaScript disabled the questions and the form around them submit
 * exactly as they do today — only the bar itself, which needs `useState` to
 * animate, never appears. Nothing here reads `FormData`, gates the submit
 * button, or replaces the radios' own `required` validation.
 *
 * Answered state is derived from `change` events on the `q_*` radio groups
 * bubbling to one delegated handler on the wrapping `div`, matching every
 * question staying an uncontrolled, server-rendered `<input>` rather than
 * becoming a controlled React form. The count seeds itself once on mount from
 * whatever is already checked — a draft resumed from "save and finish later"
 * — then tracks further changes the same way, so reloading a part-answered
 * draft doesn't regress the bar to zero.
 *
 * `labelTemplate` is a whole, already-translated sentence with `{answered}`/
 * `{total}` placeholders (`waiver.questionsAnswered`), resolved server-side by
 * `diverTranslator` and filled in here with the live counts — this page has
 * no `DiverIntlProvider`, so a Client Component on it cannot call
 * `useTranslations()` itself. Same `fill()`-template pattern as
 * `ScheduleBuilder.tsx`'s `BuilderCopy`.
 */
export function QuestionnaireProgress({
  total,
  labelTemplate,
  children,
}: {
  /** Total number of questions in the presented questionnaire. */
  total: number;
  labelTemplate: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());

  // Seed from whatever the server already rendered checked (a resumed
  // draft) — the `change` handler below only ever sees choices made *after*
  // this mounts, so without this a part-answered reload would misreport
  // zero until the diver touched a question that was already filled in.
  useEffect(() => {
    const checked = containerRef.current?.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name^="q_"]:checked',
    );
    if (!checked || checked.length === 0) return;
    setAnswered((prev) => {
      const next = new Set(prev);
      for (const input of checked) next.add(input.name);
      return next;
    });
  }, []);

  function handleChange(event: React.ChangeEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) ||
      target.type !== "radio" ||
      !target.name.startsWith("q_")
    ) {
      return;
    }
    setAnswered((prev) => (prev.has(target.name) ? prev : new Set(prev).add(target.name)));
  }

  const percent = total === 0 ? 0 : Math.min(100, (answered.size / total) * 100);

  return (
    <div ref={containerRef} onChange={handleChange}>
      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-2">
        {/* Announces the running count, not the click that changed it — one
            polite region a diver revisiting an already-answered question
            doesn't re-trigger a screen-reader interruption for. */}
        <p role="status" className="text-sm font-medium text-muted">
          {fill(labelTemplate, { answered: answered.size, total })}
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 ease-[var(--ease-out-soft)]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      {children}
    </div>
  );
}
