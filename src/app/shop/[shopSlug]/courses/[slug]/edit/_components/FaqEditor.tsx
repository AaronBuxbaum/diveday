"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { fill, pluralForm } from "@/i18n/fill";
import { MAX_FAQS } from "@/lib/course-limits";
import type { CourseFaq } from "@/lib/courses";
import { draftFieldValue } from "./UnsavedChangesGuard";

/**
 * Every value is a plain ICU-style template string, never a function — the
 * row count is unbounded and changes purely client-side, so there is no fixed
 * set of server-rendered strings to hand down. Same contract as
 * `DayByDayEditorCopy` next door, for the same reason.
 */
export interface FaqEditorCopy {
  questionLabel: string;
  questionPlaceholder: string;
  answerLabel: string;
  answerPlaceholder: string;
  removeFaq: string;
  addFaq: string;
  faqsMaxOne: string;
  faqsMaxOther: string;
  empty: string;
}

type Row = CourseFaq & { key: number };

/**
 * **A question and its answer, in two boxes.**
 *
 * This was one `<textarea>` carrying a format a shop had to remember: blocks
 * separated by blank lines, the first line of each being the question. The
 * caption explaining it was longer than most of the answers, and a shop that
 * forgot the blank line silently published one enormous question — `parseFaqs`
 * dropped the pair whose answer came out empty, with nothing on screen to say
 * so (issue #815). Its two neighbours in this form already had real editors,
 * and so did the whole dive-site form; this was the last hand-encoded format.
 *
 * State lives here and serializes to one hidden JSON field on every change —
 * the surrounding `<form>` submits it like any other field, and
 * `sanitizeFaqs` (src/lib/courses.ts) validates it server-side. Rows carry a
 * `key` of their own rather than using the array index, so removing the first
 * of three does not make React re-use its DOM node for the second and move the
 * cursor out from under whoever was typing.
 */
export function FaqEditor({
  initialFaqs,
  storageKey,
  copy,
}: {
  initialFaqs: CourseFaq[];
  /** The unsaved-work draft these rows are part of; see `draftFieldValue`. */
  storageKey: string;
  copy: FaqEditorCopy;
}) {
  const [nextKey, setNextKey] = useState(initialFaqs.length);
  const [rows, setRows] = useState<Row[]>(() =>
    initialFaqs.map((faq, index) => ({ ...faq, key: index })),
  );
  const hidden = useRef<HTMLInputElement>(null);
  const atMax = rows.length >= MAX_FAQS;

  // The rows as the writer last left them, if this visit is a return to
  // unsaved work. In an effect rather than the initial state, so the server
  // and the first client render agree; the `input` event is what tells
  // `UnsavedChangesGuard` the form is dirty, since nothing was typed.
  useEffect(() => {
    const draft = draftFieldValue(storageKey, "faqsJson");
    if (!draft) return;
    let saved: CourseFaq[];
    try {
      saved = JSON.parse(draft) as CourseFaq[];
      if (!Array.isArray(saved)) return;
    } catch {
      return;
    }
    if (draft === JSON.stringify(initialFaqs.map(({ question, answer }) => ({ question, answer }))))
      return;
    setRows(saved.map((faq, index) => ({ ...faq, key: index })));
    setNextKey(saved.length);
    hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [storageKey, initialFaqs]);

  function update(key: number, patch: Partial<CourseFaq>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? <p className="text-sm text-muted">{copy.empty}</p> : null}
      {rows.map((row, index) => (
        <div
          key={row.key}
          className="rounded-inset border border-border bg-surface-sunken p-3 sm:p-4"
        >
          <FieldGrid columns={1} className="gap-y-3">
            <Field label={fill(copy.questionLabel, { number: index + 1 })}>
              <input
                type="text"
                maxLength={200}
                value={row.question}
                placeholder={copy.questionPlaceholder}
                onChange={(event) => update(row.key, { question: event.target.value })}
                className={controlClass}
              />
            </Field>
            <Field label={copy.answerLabel}>
              <textarea
                rows={3}
                maxLength={1200}
                value={row.answer}
                placeholder={copy.answerPlaceholder}
                onChange={(event) => update(row.key, { answer: event.target.value })}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
              className={buttonClass({ variant: "danger-ghost", size: "sm" })}
            >
              {fill(copy.removeFaq, { number: index + 1 })}
            </button>
          </div>
        </div>
      ))}
      {atMax ? (
        <p className="text-sm text-muted">
          {fill(pluralForm(MAX_FAQS, { one: copy.faqsMaxOne, other: copy.faqsMaxOther }), {
            max: MAX_FAQS,
          })}
        </p>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              setRows((current) => [...current, { question: "", answer: "", key: nextKey }]);
              setNextKey((key) => key + 1);
            }}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.addFaq}
          </button>
        </div>
      )}
      <input
        ref={hidden}
        type="hidden"
        name="faqsJson"
        value={JSON.stringify(rows.map(({ question, answer }) => ({ question, answer })))}
      />
    </div>
  );
}
