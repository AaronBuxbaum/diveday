"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupLabelClass } from "@/components/ui/ledger";
import { LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { useExitAnimation } from "@/components/useExitAnimation";
import { useFocusTrap } from "@/components/useFocusTrap";

/**
 * A roll-call event as it happened today. The server resolves the words and
 * the shop's timezone before handing this small, serializable record to the
 * sheet; the client only owns opening and closing the surface.
 */
export type PersonTrailEntry = {
  label: string;
  detail: string;
  state: "aboard" | "ashore" | "notBack";
  note?: string | null;
};

const SHEET_DURATION_MS = 200;

function TrailMark({ state }: { state: PersonTrailEntry["state"] }) {
  const className =
    state === "aboard"
      ? "border-success text-success-strong"
      : state === "notBack"
        ? "border-danger text-danger"
        : "border-warning text-warning-strong";

  return (
    <span
      aria-hidden="true"
      className={`grid size-5 shrink-0 place-items-center rounded-full border ${className}`}
    >
      <svg
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3.5"
      >
        <title>{state}</title>
        {state === "aboard" ? <path d="m4.5 9.3 2.4 2.4 5.3-5.8" /> : null}
        {state === "ashore" ? <path d="M4 9h10" /> : null}
        {state === "notBack" ? <path d="m5 5 8 8M13 5l-8 8" /> : null}
      </svg>
    </span>
  );
}

/**
 * The one-tap person sheet from the boat manifest (ADR
 * 20260827-the-departure-is-two-working-surfaces, decision 2).
 *
 * The row remains quiet at rest: its trigger is the name column and the
 * affirmative roll-call mark remains a separate control. Details are
 * rendered only while the sheet is open, so the list does not grow by the
 * height of every person's contact record and the printed manifest can keep
 * its own unconditional facts block.
 */
export function PersonSheet({
  name,
  trigger,
  triggerLabel,
  subtitle,
  status,
  trail,
  todayLabel,
  noTodayEventsLabel,
  buddy,
  buddyLabel,
  children,
  closeLabel,
  triggerClassName,
}: {
  name: string;
  trigger: React.ReactNode;
  triggerLabel: string;
  subtitle: string;
  status: React.ReactNode;
  trail: readonly PersonTrailEntry[];
  todayLabel: string;
  noTodayEventsLabel: string;
  buddy?: React.ReactNode;
  buddyLabel: string;
  children: React.ReactNode;
  closeLabel: string;
  triggerClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const sheetId = useId();
  const { mounted, closing } = useExitAnimation(open, SHEET_DURATION_MS);

  useFocusTrap(open, sheetRef);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  const overlay = mounted ? (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a presentational click-away surface
    <div
      className={`fixed inset-0 z-50 flex items-end bg-foreground/30 backdrop-blur-sm print:hidden ${closing ? "animate-fade-out" : "animate-fade-in"}`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={sheetRef}
        id={sheetId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={`max-h-[min(90dvh,48rem)] w-full overflow-y-auto overscroll-contain rounded-t-[22px] border-t border-border bg-surface px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl outline-none sm:mx-auto sm:max-w-2xl sm:px-7 ${closing ? "sheet-out" : "rise-in"}`}
      >
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-border-strong" />
        <header className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className={LEAD_TITLE_CLASS}>
              {name}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-muted">
              {subtitle}
            </p>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {status}
            <button
              type="button"
              aria-label={closeLabel}
              className="grid size-11 place-items-center rounded-full text-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
              onClick={close}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
        </header>

        <section className="mt-5" aria-label={todayLabel}>
          <p className={groupLabelClass()}>{todayLabel}</p>
          {trail.length > 0 ? (
            <ol className="mt-1">
              {trail.map((entry, index) => (
                <li key={`${entry.label}-${entry.detail}`}>
                  <div className="flex min-h-10 items-center gap-2.5">
                    <TrailMark state={entry.state} />
                    <span className="min-w-0 flex-1 text-sm">
                      <span
                        className={entry.state === "notBack" ? "font-semibold text-danger" : ""}
                      >
                        {entry.label}
                      </span>
                      {entry.note ? (
                        <span className="mt-0.5 block text-sm text-muted">{entry.note}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{entry.detail}</span>
                  </div>
                  {index < trail.length - 1 ? (
                    <div aria-hidden="true" className="ms-[9px] border-s border-border py-1" />
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted">{noTodayEventsLabel}</p>
          )}
        </section>

        {buddy ? (
          <section className="mt-4" aria-label={buddyLabel}>
            <p className={groupLabelClass()}>{buddyLabel}</p>
            <div className="mt-1">{buddy}</div>
          </section>
        ) : null}

        <div className="mt-4">{children}</div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={sheetId}
        aria-label={triggerLabel}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        {trigger}
        <DisclosureCaret className="shrink-0" />
      </button>
      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
