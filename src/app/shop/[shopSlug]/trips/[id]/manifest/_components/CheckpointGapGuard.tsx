"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";

/**
 * **Opening the next after-dive roll call asks first while the one before it
 * is open** (batch 6, item 3). A warning with a confirm, never a refusal: the
 * crew can always open any checkpoint, one more tap away.
 *
 * Wraps the checkpoint switch and catches a tap on a checkpoint that has a
 * prompt — `onClickCapture` on the wrapper runs before the `<Link>`'s own
 * handler, which honours `defaultPrevented` — then says who is still
 * unmarked, with "Back to dive N" leading and "Open anyway" beside it. A
 * modified click (new tab) passes straight through, and so does every tap
 * before JavaScript: the page then says the same line on the checkpoint it
 * opens (`CheckpointSwitch`), so the warning never depends on this script.
 */
export type CheckpointGapPrompt = {
  /** The checkpoint being opened, as `SegmentedControl` keys it. */
  key: string;
  href: string;
  /** "2 people not marked after dive 1." */
  line: string;
  openAnyway: string;
  /** Leads: finish the open roll call. */
  back: string;
  /** The open checkpoint's key, so "back" to the page already open only puts the prompt away. */
  backKey: string;
  backHref: string;
};

export function CheckpointGapGuard({
  prompts,
  current,
  children,
}: {
  prompts: readonly CheckpointGapPrompt[];
  /** The open checkpoint; a change of it (a navigation) puts the prompt away. */
  current: string;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is a trigger — a navigation landed, so the question has been answered.
  useEffect(() => {
    setArmed(null);
  }, [current]);
  useEffect(() => {
    if (armed) lineRef.current?.focus({ preventScroll: true });
  }, [armed]);
  const prompt = prompts.find((entry) => entry.key === armed) ?? null;
  return (
    <div
      onClickCapture={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        const link = (event.target as HTMLElement).closest<HTMLElement>("a[data-key]");
        const key = link?.dataset.key;
        if (!key || key === current) return;
        if (!prompts.some((entry) => entry.key === key)) return;
        event.preventDefault();
        setArmed(key);
      }}
    >
      {children}
      {prompt ? (
        <div className={`mt-3 ${TONE_PANEL_CLASS} border-danger/60 bg-surface print:hidden`}>
          <p ref={lineRef} tabIndex={-1} role="alert" className="text-base font-bold text-danger">
            {prompt.line}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {prompt.backKey === current ? (
              <button
                type="button"
                onClick={() => setArmed(null)}
                className={buttonClass({ variant: "primary", size: "boat" })}
              >
                {prompt.back}
              </button>
            ) : (
              <Link
                href={prompt.backHref}
                scroll={false}
                className={buttonClass({ variant: "primary", size: "boat" })}
              >
                {prompt.back}
              </Link>
            )}
            <Link
              href={prompt.href}
              scroll={false}
              className={buttonClass({ variant: "secondary", size: "boat" })}
            >
              {prompt.openAnyway}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
