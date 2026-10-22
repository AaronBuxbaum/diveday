"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";

/** Keep both the initial list and each deliberate continuation to five records. */
const CANDIDATES_PER_BATCH = 5;

export type MergeCandidateOption = {
  fullName: string;
  contact: string;
  reasons: string;
  href: string;
  compareWith: string;
};

/** A comparison is still the only door from this list; revealing never writes a record. */
export function MergeCandidateList({
  candidates,
  compare,
  showMore,
}: {
  candidates: MergeCandidateOption[];
  compare: string;
  showMore: string;
}) {
  const listId = useId();
  const [shownCount, setShownCount] = useState(CANDIDATES_PER_BATCH);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const firstNewComparison = useRef<HTMLAnchorElement>(null);

  // Only a deliberate reveal changes this index. Parent rerenders leave focus alone.
  useEffect(() => {
    if (focusIndex !== null) firstNewComparison.current?.focus();
  }, [focusIndex]);

  return (
    <>
      <ul id={listId} className="mt-4 grid gap-2">
        {candidates.slice(0, shownCount).map((candidate, index) => (
          <li
            key={candidate.href}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="block font-medium">{candidate.fullName}</span>
              <span className="mt-0.5 block text-base text-muted">{candidate.contact}</span>
              <span className="mt-1 block text-base text-warning-strong">{candidate.reasons}</span>
            </span>
            <Link
              ref={index === focusIndex ? firstNewComparison : undefined}
              href={candidate.href}
              aria-label={candidate.compareWith}
              className={buttonClass({ variant: "secondary" })}
            >
              {compare}
            </Link>
          </li>
        ))}
      </ul>
      {shownCount < candidates.length ? (
        <button
          type="button"
          aria-controls={listId}
          className={buttonClass({ variant: "ghost", className: "mt-2" })}
          onClick={() => {
            setFocusIndex(shownCount);
            setShownCount(Math.min(shownCount + CANDIDATES_PER_BATCH, candidates.length));
          }}
        >
          {showMore}
        </button>
      ) : null}
    </>
  );
}
