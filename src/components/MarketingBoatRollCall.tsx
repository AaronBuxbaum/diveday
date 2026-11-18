"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { SettledCheck } from "@/components/ui/SettledCheck";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";

type BoatLabels = {
  open: string;
  closed: string;
  countOpen: string;
  countClosed: string;
  name: string;
  answered: string;
  aboard: string;
  markAboard: string;
  restart: string;
};

export function MarketingBoatRollCall({ labels }: { labels: BoatLabels }) {
  const [aboard, setAboard] = useState(false);
  return (
    <figcaption className="px-4 py-4 sm:px-5">
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
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <SettledCheck settled={aboard} label={labels.name} labelClassName="font-semibold">
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
  );
}
