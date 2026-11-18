"use client";

import { type ReactNode, useId, useState } from "react";
import {
  type BoatStageLabels,
  DIVER_INDICES,
  type DiverIndex,
  MarketingBoatStage,
} from "@/components/MarketingBoatStage";
import { buttonClass } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/StatusMark";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";

type BoatLabels = BoatStageLabels & {
  open: string;
  closed: string;
  counts: [string, string, string];
  choose: string;
  aboard: string;
  restart: string;
  record: string;
  checkpoint: string;
  previously: string;
};

export function MarketingBoatRollCall({
  labels,
  poster,
}: {
  labels: BoatLabels;
  poster: ReactNode;
}) {
  const descriptionId = useId();
  const [selected, setSelected] = useState<DiverIndex | null>(null);
  const [confirmationOrder, setConfirmationOrder] = useState<DiverIndex[]>([]);
  const checked: [boolean, boolean] = [
    confirmationOrder.includes(0),
    confirmationOrder.includes(1),
  ];
  const complete = confirmationOrder.length === 2;
  const diver = selected === null ? null : labels.divers[selected];

  function confirm(index: DiverIndex) {
    setConfirmationOrder((order) => (order.includes(index) ? order : [...order, index]));
  }

  function restart() {
    setConfirmationOrder([]);
    setSelected(null);
  }

  return (
    <>
      <MarketingBoatStage
        labels={labels}
        poster={poster}
        checked={checked}
        selected={selected}
        onSelect={setSelected}
        onOverview={() => setSelected(null)}
      />
      <figcaption className="px-4 py-4 sm:px-5">
        <div
          role="status"
          aria-atomic="true"
          className="flex min-h-7 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
        >
          <span className={ITEM_TITLE_CLASS}>{complete ? labels.closed : labels.open}</span>
          <span className="text-sm font-medium text-muted tabular-nums">
            {labels.counts[confirmationOrder.length]}
          </span>
        </div>
        {complete ? (
          <button
            type="button"
            data-try-tap=""
            onClick={restart}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {labels.restart}
          </button>
        ) : (
          <p className="mt-2 text-sm text-muted">{labels.choose}</p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {DIVER_INDICES.map((index) => {
            const person = labels.divers[index];
            return (
              <button
                key={person.name}
                type="button"
                data-try-tap=""
                aria-pressed={selected === index}
                aria-label={person.select}
                aria-describedby={checked[index] ? `${descriptionId}-${index}` : undefined}
                onClick={() => setSelected(index)}
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                  className:
                    "w-full aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-inset",
                })}
              >
                <StatusMark
                  variant={checked[index] ? "success" : "pending"}
                  className={checked[index] ? "text-success" : "text-muted"}
                />
                <span>{person.name}</span>
                {checked[index] ? (
                  <span className="sr-only" id={`${descriptionId}-${index}`}>
                    {labels.aboard}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {selected !== null && diver ? (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-sm font-semibold">{diver.place}</p>
            <p className="mt-1 text-sm leading-5 text-muted">{diver.gear}</p>
            <button
              type="button"
              data-try-tap=""
              aria-disabled={checked[selected]}
              onClick={() => {
                if (!checked[selected]) confirm(selected);
              }}
              className={buttonClass({
                variant: checked[selected] ? "bare" : "primary",
                size: "sm",
                className: "mt-2",
              })}
            >
              {checked[selected] ? <StatusMark variant="success" className="text-success" /> : null}
              {checked[selected] ? labels.aboard : diver.confirm}
            </button>
          </div>
        ) : null}
        {complete ? (
          <details className="mt-3 border-t border-border">
            <summary className="min-h-11 cursor-pointer content-center py-2 text-sm font-semibold text-primary">
              {labels.record}
            </summary>
            <div className="rounded-inset bg-surface-sunken px-3 py-2 text-sm">
              <p className="font-semibold">{labels.checkpoint}</p>
              <p className="mt-1 text-muted">{labels.previously}</p>
              <ol className="mt-2 divide-y divide-border">
                {confirmationOrder.map((index) => (
                  <li key={index} className="flex items-center gap-2 py-1">
                    <StatusMark variant="success" className="text-success" />
                    {labels.divers[index].name}
                  </li>
                ))}
              </ol>
            </div>
          </details>
        ) : null}
      </figcaption>
    </>
  );
}
