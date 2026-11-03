"use client";
import { useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import type { GearItemKind } from "@/lib/gear";
import type { CartWords, PickerUnit } from "./CounterRentalCart";

function lookupText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function CounterRentalPicker({
  groups,
  pickedIds,
  toggle,
  words,
}: {
  groups: { kind: GearItemKind; kindLabel: string; units: PickerUnit[] }[];
  pickedIds: readonly string[];
  toggle: (id: string) => void;
  words: CartWords;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<GearItemKind | undefined>(groups[0]?.kind);
  const [query, setQuery] = useState("");
  const shown = groups.find((group) => group.kind === kind) ?? groups[0];
  const terms = lookupText(query).trim().split(/\s+/).filter(Boolean);
  const matching =
    shown?.units.filter((unit) => {
      const text = lookupText(`${unit.label} ${unit.size ?? ""}`);
      return terms.every((term) => text.includes(term));
    }) ?? [];
  return (
    <SectionCard title={words.gearHeading}>
      <fieldset aria-label={words.kindsAria} className="flex min-w-0 flex-wrap gap-2">
        {groups.map((group) => {
          const chosen = group.kind === shown?.kind;
          const taken = group.units.filter((unit) => pickedIds.includes(unit.id)).length;
          return (
            <button
              key={group.kind}
              type="button"
              aria-pressed={chosen}
              onClick={() => {
                setKind(group.kind);
                setQuery("");
              }}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-base font-medium transition-colors ${
                chosen
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface hover:bg-surface-sunken"
              }`}
            >
              {group.kindLabel}
              {taken > 0 ? (
                <span
                  className={`rounded-full px-1.5 text-xs tabular-nums ${
                    chosen ? "bg-primary-foreground text-primary" : "bg-primary-tint text-primary"
                  }`}
                >
                  {taken}
                </span>
              ) : null}
            </button>
          );
        })}
      </fieldset>
      <div className="mt-4 flex items-end gap-2">
        <Field label={words.filterLabel} className="min-w-0 flex-1">
          <input
            ref={searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            className={controlClass}
          />
        </Field>
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              searchInput.current?.focus();
            }}
            className={buttonClass({ variant: "secondary" })}
          >
            {words.clearFilter}
          </button>
        ) : null}
      </div>
      {shown ? (
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {matching.map((unit) => {
            const on = pickedIds.includes(unit.id);
            return (
              <li key={unit.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={unit.blocked !== null}
                  onClick={() => toggle(unit.id)}
                  className={`flex h-full min-h-14 w-full items-start gap-2 rounded-lg border p-3 text-start text-base transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    on
                      ? "border-primary bg-primary-tint"
                      : "border-border bg-surface enabled:hover:bg-surface-sunken"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border ${
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border-strong"
                    }`}
                  >
                    {on ? (
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        className="size-3"
                      >
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {unit.label}
                      {unit.size ? (
                        <span className="font-normal text-muted"> · {unit.size}</span>
                      ) : null}
                    </span>
                    {unit.blocked ? (
                      <span className="block text-muted">{unit.blocked}</span>
                    ) : unit.care.length > 0 ? (
                      <span className="block text-warning-strong">{unit.care.join(" · ")}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {matching.length === 0 ? (
        <p role="status" className="mt-4 text-base text-muted">
          {words.noMatches}
        </p>
      ) : null}
    </SectionCard>
  );
}
