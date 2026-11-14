"use client";

import { useId, useRef, useState } from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { StoredPhoto } from "@/components/StoredPhoto";
import type { MarineLifeCard } from "@/i18n/marine-life-labels";

/** The same note opens on pointer hover, focus, or a tap. */
export function WildlifeTile({
  card,
  seen,
  seenLabel,
  photo,
  sizes,
  alignEnd = false,
}: {
  card: MarineLifeCard;
  seen: boolean;
  seenLabel: string;
  photo: string;
  sizes: string;
  alignEnd?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const openBeforePointer = useRef(false);
  return (
    <li
      data-pitch-tile
      className="relative min-w-0"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="w-full rounded-inset text-start focus-visible:focus-ring-inset"
        aria-expanded={open}
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onPointerDown={() => {
          openBeforePointer.current = open;
        }}
        onClick={(event) => setOpen(event.detail === 0 ? !open : !openBeforePointer.current)}
      >
        <StoredPhoto
          src={photo}
          alt=""
          className="aspect-[4/3] w-full rounded-inset"
          sizes={sizes}
        />
        <span className="mt-1 flex items-start gap-1 text-sm leading-tight font-medium">
          <span>{card.name}</span>
          <DiveDayIcon name="info" className="size-4 shrink-0 text-muted" aria-hidden="true" />
        </span>
        {seen ? <span className="mt-1 block text-xs text-muted">{seenLabel}</span> : null}
      </button>
      <div
        id={id}
        role="tooltip"
        className={`${open ? "block" : "hidden"} absolute z-10 ${alignEnd ? "end-0" : "start-0"} w-60 max-w-[80vw] rounded-inset border border-border bg-surface p-3 text-sm shadow-lg`}
      >
        <p>{card.description}</p>
        {card.preparationTip ? <p className="mt-2">{card.preparationTip}</p> : null}
      </div>
    </li>
  );
}
