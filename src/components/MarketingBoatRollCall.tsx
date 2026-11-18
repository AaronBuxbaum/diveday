"use client";

import { type ReactNode, useState } from "react";
import { type BoatStageLabels, MarketingBoatStage } from "@/components/MarketingBoatStage";
import { buttonClass } from "@/components/ui/button";
import { SettledCheck } from "@/components/ui/SettledCheck";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";

type BoatLabels = BoatStageLabels & {
  open: string;
  closed: string;
  countOpen: string;
  countClosed: string;
  answered: string;
  aboard: string;
  markAboard: string;
  restart: string;
};

export function MarketingBoatRollCall({
  labels,
  poster,
}: {
  labels: BoatLabels;
  poster: ReactNode;
}) {
  const [aboard, setAboard] = useState(false);
  return (
    <>
      <MarketingBoatStage
        labels={labels}
        poster={poster}
        aboard={aboard}
        onConfirm={() => setAboard(true)}
      />
      <figcaption className="@container px-4 py-4 sm:px-5">
        <div
          role="status"
          aria-atomic="true"
          className="flex min-h-7 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
        >
          <span className={ITEM_TITLE_CLASS}>{aboard ? labels.closed : labels.open}</span>
          <span className="text-sm font-medium text-muted tabular-nums">
            {aboard ? labels.countClosed : labels.countOpen}
          </span>
        </div>
        <div className="mt-3 grid items-center gap-3 border-t border-border pt-3 @min-[18rem]:grid-cols-[minmax(0,1fr)_auto]">
          <SettledCheck
            settled={aboard}
            label={labels.name}
            className="text-sm leading-5"
            labelClassName="font-semibold"
          >
            <span className="basis-full text-sm text-muted">
              {aboard ? labels.aboard : labels.answered}
            </span>
          </SettledCheck>
          <button
            type="button"
            data-try-tap=""
            onClick={() => setAboard(!aboard)}
            className={buttonClass({ variant: aboard ? "ghost" : "secondary", size: "sm" })}
          >
            {aboard ? labels.restart : labels.markAboard}
          </button>
        </div>
      </figcaption>
    </>
  );
}
