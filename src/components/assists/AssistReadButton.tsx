"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * **Ask, then read** (the `dupes` assist): a quiet button whose answer is a
 * short read shown in place (a verdict line and its reasons) rather than text
 * for a box. The read decides nothing; the page's own controls are still the
 * way through. A dark or failed assist shows nothing.
 */
export function AssistReadButton({
  read,
  label,
  pendingLabel,
}: {
  read: () => Promise<{ heading: string; lines: string[] } | null>;
  label: string;
  pendingLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [answer, setAnswer] = useState<{ heading: string; lines: string[] } | null>(null);

  function run() {
    startTransition(async () => {
      try {
        setAnswer(await read());
      } catch {
        setAnswer(null);
      }
    });
  }

  return (
    <div>
      {answer ? null : (
        <button
          type="button"
          onClick={run}
          disabled={pending}
          aria-busy={pending || undefined}
          className={buttonClass({ variant: "ghost", size: "sm", busy: pending })}
        >
          {pending ? pendingLabel : label}
        </button>
      )}
      <div aria-live="polite">
        {answer ? (
          <>
            <p className="text-sm font-medium">{answer.heading}</p>
            {answer.lines.length > 0 ? (
              <ul className="mt-1 list-disc ps-5 text-sm text-muted">
                {answer.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
