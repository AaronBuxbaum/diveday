"use client";

import { type ReactNode, useEffect, useState } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import {
  ITEM_TITLE_CLASS,
  PAGE_TITLE_CLASS,
  SECTION_TITLE_CLASS,
} from "@/components/ui/typography";

export type GuestFolio = {
  id: string;
  name: string;
  photoPath?: string | null;
  status: string;
  summary?: string;
  needsAttention: boolean;
  party: string | null;
  panel: ReactNode;
};

/** Selecting a folio never performs a booking, arrival or presence action. */
export function GuestFolios({
  guests,
  initialBookingId,
  copy,
  overview,
}: {
  guests: GuestFolio[];
  overview?: ReactNode;
  initialBookingId?: string;
  copy: {
    heading: string;
    search: string;
    all: string;
    next: string;
    empty: string;
    party: string;
    attention: string;
    requirementsMet: string;
  };
}) {
  const [selected, setSelected] = useState(initialBookingId ?? null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const reveal = (hash: string) => {
      if (/^#(?:roster|add-diver|add-a-booking|who-wants-in)/.test(hash)) setSelected(null);
      const match = hash.match(/^#(?:move-)?booking-(.+)$/);
      if (match && guests.some((guest) => guest.id === match[1])) setSelected(match[1]);
      if (hash.startsWith("#guest-reference-"))
        document.getElementById(hash.slice(1))?.setAttribute("open", "");
    };
    const readHash = () => reveal(window.location.hash);
    const anchor = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self")) return;
      const destination = new URL(link.href);
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search &&
        /^#(?:roster|add-diver|add-a-booking|who-wants-in|guest-reference-|(?:move-)?booking-)/.test(
          destination.hash,
        )
      ) {
        // Revealing another surface can unmount this Link before its bubbling
        // handler runs. Commit through Next's patched history API first so a
        // later action refresh keeps this destination, rather than the old guest.
        event.preventDefault();
        window.history.pushState(null, "", destination);
        reveal(destination.hash);
        window.requestAnimationFrame?.(() => {
          document.getElementById(destination.hash.slice(1))?.scrollIntoView?.({ block: "start" });
        });
      }
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    document.addEventListener("click", anchor, true);
    return () => {
      window.removeEventListener("hashchange", readHash);
      document.removeEventListener("click", anchor, true);
    };
  }, [guests]);
  useEffect(() => {
    // A refreshed action can retain its earlier booking context. An explicit
    // recruitment or guest hash remains the reader's selected destination.
    const explicitDestination =
      /^#(?:roster|add-diver|add-a-booking|who-wants-in|(?:move-)?booking-)/.test(
        window.location.hash,
      );
    if (initialBookingId && !explicitDestination) setSelected(initialBookingId);
  }, [initialBookingId]);
  useEffect(() => {
    if (selected && window.location.hash === `#move-booking-${selected}`) {
      document.getElementById(`guest-reference-${selected}`)?.setAttribute("open", "");
    }
  }, [selected]);
  const current = guests.find((guest) => guest.id === selected);
  const select = (id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    url.hash = id ? `booking-${id}` : "roster";
    window.history.replaceState(null, "", url);
  };
  const ordered = current
    ? [...guests.slice(guests.indexOf(current) + 1), ...guests.slice(0, guests.indexOf(current))]
    : guests;
  const next = ordered.find((guest) => guest.needsAttention);
  const visible = guests.filter((guest) =>
    `${guest.name} ${guest.party ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <div data-guest-folios data-guest-folio={current?.id} className="space-y-4">
      {current ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => select(null)}
              className={buttonClass({ variant: "link", flush: true })}
            >
              {copy.all}
            </button>
            {next ? (
              <button
                type="button"
                onClick={() => select(next.id)}
                className={buttonClass({
                  variant: "link",
                  flush: true,
                  className: "max-w-48 text-end",
                })}
              >
                {copy.next}
              </button>
            ) : null}
          </div>
          <div className="border-b border-border pb-3">
            {current.party ? (
              <p className="text-sm text-muted">
                {copy.party} · {current.party}
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-3">
              <PersonAvatar name={current.name} photoPath={current.photoPath} />
              <h2 className={PAGE_TITLE_CLASS}>{current.name}</h2>
            </div>
            <p className="mt-2 text-muted">
              {current.summary ?? (current.needsAttention ? copy.attention : copy.requirementsMet)}
            </p>
          </div>
          <ul className="list-none">{current.panel}</ul>
        </>
      ) : (
        <>
          <h2 className={SECTION_TITLE_CLASS}>{copy.heading}</h2>
          <Field label={copy.search} htmlFor="guest-folio-search">
            <input
              id="guest-folio-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={controlClass}
            />
          </Field>
          <ul className="divide-y divide-border border-y border-border">
            {visible.map((guest) => (
              <li key={guest.id}>
                <button
                  type="button"
                  data-guest-open={guest.id}
                  aria-labelledby={`guest-name-${guest.id}`}
                  aria-describedby={`guest-status-${guest.id}`}
                  onClick={() => select(guest.id)}
                  className="flex min-h-20 w-full items-center gap-3 py-4 text-start hover:bg-surface-sunken focus-visible:focus-ring-inset"
                >
                  <PersonAvatar name={guest.name} photoPath={guest.photoPath} size="sm" />
                  <span className="flex min-w-0 flex-col items-start gap-1">
                    <span id={`guest-name-${guest.id}`} className={ITEM_TITLE_CLASS}>
                      {guest.name}
                    </span>
                    <span
                      id={`guest-status-${guest.id}`}
                      className={
                        guest.needsAttention ? "text-sm text-warning-strong" : "text-sm text-muted"
                      }
                    >
                      {guest.status}
                    </span>
                    {guest.party ? (
                      <span className="text-sm text-muted">
                        {copy.party} · {guest.party}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 ? <p className="text-muted">{copy.empty}</p> : null}
          {overview}
        </>
      )}
    </div>
  );
}
