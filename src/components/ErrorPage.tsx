"use client";

import { type ButtonSize, buttonClass } from "@/components/ui/button";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";

/**
 * The shape every `error.tsx` in this app wears.
 *
 * A Next error boundary is a file convention with a fixed `{error, reset}`
 * signature, so there are eleven of them and they cannot share a parent
 * component the framework instantiates for them. What they *can* share is the
 * body they render, and until this existed they didn't: eleven files each
 * spelled out the same centered column, the same `text-2xl` heading, the same
 * `mt-3 text-muted` line, and the same `mt-6` reset button — byte for byte,
 * eleven times, with nothing keeping them in step. A boundary is the one
 * surface nobody looks at on the golden path, which is exactly why drift here
 * goes unnoticed until a diver meets it.
 *
 * Words stay in the boundary, never here. Each `error.tsx` resolves its own —
 * the diver routes through `useTranslations("errorBoundary")` fed by the
 * provider their `layout.tsx` mounts above the boundary (ADR
 * 20260803-error-boundary-copy-bridge), the two staff ones through the English
 * literals that ADR names as its known remainder. This component takes strings
 * and renders them, so it reads no translator and belongs to no bundle.
 *
 * The heading is `SHELL_TITLE_CLASS` — the one size every page reached from
 * a link says its own name at (ADR 20260827-the-divers-thread, decision 1).
 *
 * `size` is the one thing the eleven genuinely disagreed about, and the
 * disagreement is real rather than drift: the boat surfaces want the 56px
 * wet-hands target, a diver mid-booking wants the marketing-weight `cta`, and
 * everything else wants the default.
 *
 * The `error` itself is never rendered — not its message, not its digest, not
 * its stack. Every boundary destructures `reset` alone and drops `error` on
 * purpose; a component that had no way to show it keeps that true by
 * construction.
 */
export function ErrorPage({
  title,
  body,
  resetLabel,
  onReset,
  size = "md",
}: {
  title: string;
  body: string;
  resetLabel: string;
  onReset: () => void;
  /** `boat` for the staff dock surfaces, `cta` for the diver-facing shop pages. */
  size?: ButtonSize;
}) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-16 text-center">
      <h1 className={SHELL_TITLE_CLASS}>{title}</h1>
      <p className="mt-3 text-muted">{body}</p>
      <button type="button" onClick={onReset} className={buttonClass({ size, className: "mt-6" })}>
        {resetLabel}
      </button>
    </main>
  );
}
