"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { SightingResult } from "../actions";

export type SeenSaidCopy = { label: string; add: string; adding: string };

/** A catalog suggestion is optional: the crew can always record their own words. */
export function SeenSaid({
  species,
  recordAction,
  onResult,
  copy,
}: {
  species: readonly { slug: string; name: string }[];
  recordAction: (
    previous: SightingResult | undefined,
    formData: FormData,
  ) => Promise<SightingResult>;
  onResult: (result: SightingResult) => void;
  copy: SeenSaidCopy;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [adding, startAdd] = useTransition();
  const normalize = (value: string) =>
    value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  const query = normalize(said);
  const suggestions = query ? species.filter((item) => normalize(item.name).includes(query)) : [];
  const expanded = open && suggestions.length > 0;
  useEffect(() => {
    if (expanded && active >= 0)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, expanded, id]);

  function choose(name: string) {
    setSaid(name);
    setActive(-1);
    setOpen(false);
    input.current?.focus();
  }

  function add() {
    if (!query || adding) return;
    const exact = species.find((item) => normalize(item.name) === query);
    const formData = new FormData();
    formData.set(exact ? "speciesSlug" : "customName", exact?.slug ?? said.trim());
    startAdd(async () => {
      try {
        const result = await recordAction(undefined, formData);
        onResult(result);
        if (result.status === "ok") {
          setSaid("");
          setOpen(false);
          setActive(-1);
        }
      } catch {
        onResult({ status: "error" });
      }
    });
  }

  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {copy.label}
      </label>
      <div className="mt-1 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={`${id}-options`}
            aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
            autoComplete="off"
            value={said}
            maxLength={300}
            disabled={adding}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              setActive(-1);
            }}
            onChange={(event) => {
              setSaid(event.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                if (event.key === "Enter") event.preventDefault();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                setActive(-1);
              }
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
                event.preventDefault();
                setOpen(true);
                setActive((previous) =>
                  previous < 0
                    ? event.key === "ArrowDown"
                      ? 0
                      : suggestions.length - 1
                    : (previous + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
                      suggestions.length,
                );
              }
              if (event.key === "Enter" && expanded && active >= 0) {
                event.preventDefault();
                choose(suggestions[active].name);
              }
            }}
            className={`${controlClass} w-full`}
          />
          {expanded ? (
            <div
              id={`${id}-options`}
              role="listbox"
              aria-label={copy.label}
              className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
            >
              {suggestions.map((item, index) => (
                <div
                  key={item.slug}
                  id={`${id}-option-${index}`}
                  role="option"
                  tabIndex={-1}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(item.name);
                    }
                  }}
                  aria-selected={active === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(item.name)}
                  className={`cursor-pointer px-3 py-3 text-sm ${active === index ? "bg-surface-sunken" : ""}`}
                >
                  {item.name}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={adding || !query}
          aria-busy={adding || undefined}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            busy: adding,
            className: "touch-manipulation",
          })}
        >
          {adding ? copy.adding : copy.add}
        </button>
      </div>
    </form>
  );
}
