"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { ITEM_TITLE_CLASS, SUB_TITLE_CLASS } from "@/components/ui/typography";

export type DeskState = "waiting" | "review" | "held" | "matched";

export type BoatDeskLabels = {
  checkpoint: string;
  open: string;
  pin: string;
  booking: string;
  cardTitle: string;
  match: string;
  mismatch: string;
  hold: string;
  recheck: string;
  verified: string;
  otherCard: string;
  issuedBy: string;
  level: string;
  number: string;
  prompt: string;
  pending: string;
  compare: string;
  agencyChecked: string;
  holdHint: string;
  corrected: string;
  tomCard: string;
  tomLevel: string;
  previouslyChecked: string;
};

// Deliberately fictional identifiers for the two sample cards.
const BOOKED_NUMBER = "SAMPLE-072";
const ALTERNATE_NUMBER = "SAMPLE-027";

function SampleCard({
  labels,
  name,
  level,
  number,
}: {
  labels: BoatDeskLabels;
  name: string;
  level: string;
  number: string;
}) {
  return (
    <section
      aria-label={labels.cardTitle}
      tabIndex={-1}
      data-sample-card=""
      className="relative isolate mt-3 overflow-hidden rounded-panel bg-primary p-4 text-primary-foreground"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-10 -bottom-20 -z-10 size-48 rounded-full border-[12px] border-current opacity-10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-5 -bottom-16 -z-10 size-36 rounded-full border-2 border-current opacity-20"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p className="text-base font-bold">{labels.issuedBy}</p>
        <p className="text-xs font-medium">{labels.cardTitle}</p>
      </div>
      <p className={`mt-2 leading-tight ${SUB_TITLE_CLASS}`}>{level}</p>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-current/35 pt-2">
        <p className="text-sm font-semibold">{name}</p>
        <p className="font-mono text-xs">
          <span className="sr-only">{labels.number} </span>
          {number}
        </p>
      </div>
    </section>
  );
}

export function MarketingBoatDesk({
  state,
  labels,
  name,
  tomName,
  open,
  match,
  hold,
}: {
  state: Exclude<DeskState, "matched">;
  labels: BoatDeskLabels;
  name: string;
  tomName: string;
  open: () => void;
  match: () => void;
  hold: () => void;
}) {
  const [presentedNumber, setPresentedNumber] = useState(BOOKED_NUMBER);
  const panel = useRef<HTMLElement>(null);
  const previousState = useRef(state);
  useEffect(() => {
    if (previousState.current !== state) panel.current?.focus();
    previousState.current = state;
  }, [state]);
  useEffect(() => {
    if (presentedNumber === ALTERNATE_NUMBER) {
      panel.current?.querySelector<HTMLElement>("[data-sample-card]")?.focus();
    }
  }, [presentedNumber]);
  function openReview() {
    setPresentedNumber(BOOKED_NUMBER);
    open();
  }

  if (state !== "review") {
    const held = state === "held";
    return (
      <section ref={panel} tabIndex={-1} aria-label={held ? labels.hold : labels.pending}>
        <p role="status" className={ITEM_TITLE_CLASS}>
          {held ? labels.hold : labels.pending}
        </p>
        <p className="mt-2 text-sm leading-5 text-muted">
          {held ? labels.holdHint : labels.prompt}
        </p>
        <button
          type="button"
          data-try-tap=""
          onClick={openReview}
          className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
        >
          {held ? labels.recheck : labels.open}
        </button>
        {!held ? (
          <details className="mt-2 border-t border-border">
            <summary className="min-h-11 cursor-pointer content-center py-2 text-sm font-medium text-primary">
              {labels.tomCard}
            </summary>
            <SampleCard
              labels={labels}
              name={tomName}
              level={labels.tomLevel}
              number="SAMPLE-041"
            />
          </details>
        ) : null}
      </section>
    );
  }

  return (
    <section ref={panel} tabIndex={-1} aria-label={labels.compare}>
      <p className={ITEM_TITLE_CLASS}>{labels.compare}</p>
      <SampleCard labels={labels} name={name} level={labels.level} number={presentedNumber} />
      <section aria-label={labels.booking} className="mt-3 border-b border-border pb-3">
        <p className="text-sm font-semibold">{labels.booking}</p>
        <p className="mt-1 text-sm">
          {name} · {labels.issuedBy} {labels.level}
        </p>
        <p className="text-sm text-muted">
          {labels.number} <span className="font-mono">{BOOKED_NUMBER}</span>
        </p>
        <p className="mt-1 text-xs text-muted">{labels.agencyChecked}</p>
      </section>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-try-tap=""
          onClick={() => {
            if (presentedNumber === BOOKED_NUMBER) match();
          }}
          disabled={presentedNumber !== BOOKED_NUMBER}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          {labels.match}
        </button>
        <button
          type="button"
          data-try-tap=""
          onClick={() => {
            setPresentedNumber(BOOKED_NUMBER);
            hold();
          }}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {labels.mismatch}
        </button>
      </div>
      {presentedNumber === BOOKED_NUMBER ? (
        <button
          type="button"
          data-try-tap=""
          onClick={() => setPresentedNumber(ALTERNATE_NUMBER)}
          className={buttonClass({ variant: "link", size: "sm", flush: true })}
        >
          {labels.otherCard}
        </button>
      ) : null}
    </section>
  );
}
