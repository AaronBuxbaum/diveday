"use client";

import { useId, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { SightingMatch } from "@/lib/assists/sightings-match";
import type { SightingResult } from "../actions";

export type SeenSaidCopy = {
  label: string;
  match: string;
  matching: string;
  add: string;
  adding: string;
  none: string;
  /** `{name} × {count}`, filled here: the count is only known after the match. */
  proposed: string;
};

/**
 * **Or say what you saw** (the `sightings` assist): a line the crew types or
 * dictates with the phone keyboard's own microphone, matched to this reef's
 * chips. The match is a proposal: nothing is logged until "Add these", which
 * taps each chip as many times as the proposal says, through the chip's own
 * action. A proposal can only name a chip on the row above it.
 */
export function SeenSaid({
  chips,
  match,
  recordAction,
  onResult,
  copy,
}: {
  chips: readonly { slug: string; name: string }[];
  match: (said: string) => Promise<SightingMatch[] | null>;
  recordAction: (
    previous: SightingResult | undefined,
    formData: FormData,
  ) => Promise<SightingResult>;
  onResult: (result: SightingResult) => void;
  copy: SeenSaidCopy;
}) {
  const id = useId();
  const [said, setSaid] = useState("");
  const [proposal, setProposal] = useState<SightingMatch[] | null>(null);
  const [matching, startMatch] = useTransition();
  const [adding, startAdd] = useTransition();
  const names = new Map(chips.map((chip) => [chip.slug, chip.name]));
  const shown = (proposal ?? []).filter((item) => names.has(item.slug));

  function runMatch() {
    const text = said.trim();
    if (!text) return;
    startMatch(async () => {
      try {
        setProposal((await match(text)) ?? []);
      } catch {
        setProposal([]);
      }
    });
  }

  function addAll() {
    startAdd(async () => {
      for (const item of shown) {
        for (let tap = 0; tap < item.count; tap += 1) {
          const formData = new FormData();
          formData.set("speciesSlug", item.slug);
          const result = await recordAction(undefined, formData);
          onResult(result);
          if (result.status !== "ok") return;
        }
      }
      setProposal(null);
      setSaid("");
    });
  }

  return (
    <div className="mt-4">
      <label htmlFor={id} className="text-sm font-medium">
        {copy.label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          value={said}
          maxLength={300}
          onChange={(event) => {
            setSaid(event.target.value);
            setProposal(null);
          }}
          className={`${controlClass} flex-1`}
        />
        <button
          type="button"
          onClick={runMatch}
          disabled={matching || !said.trim()}
          aria-busy={matching || undefined}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            busy: matching,
            className: "touch-manipulation",
          })}
        >
          {matching ? copy.matching : copy.match}
        </button>
      </div>
      <div aria-live="polite">
        {proposal && shown.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{copy.none}</p>
        ) : null}
        {shown.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ul className="flex flex-wrap gap-2">
              {shown.map((item) => (
                <li key={item.slug} className="rounded-full bg-surface-sunken px-3 py-1 text-sm">
                  {copy.proposed
                    .replace("{name}", names.get(item.slug) ?? "")
                    .replace("{count}", String(item.count))}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addAll}
              disabled={adding}
              aria-busy={adding || undefined}
              className={buttonClass({ size: "sm", busy: adding, className: "touch-manipulation" })}
            >
              {adding ? copy.adding : copy.add}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
