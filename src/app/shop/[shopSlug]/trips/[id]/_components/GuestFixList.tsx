"use client";

import { type ReactNode, useEffect, useState } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/StatusMark";

/** One guest the list can open in place. */
export type FixListGuest = {
  id: string;
  name: string;
  photoPath: string | null;
  /** The opened guest: fixes, then facts, then the rare actions. */
  panel: ReactNode;
};

export type FixListRow = {
  key: string;
  guestIds: string[];
  /** A row about the trip rather than a guest (no crew, a hull on two departures): its words. */
  title?: string;
  /** Every reason that stands for the guest, in one line. */
  phrase: string | null;
  tone: "danger" | "warning" | "muted";
  /** The row's one button, drawn by the server: Check in, Send waiver, a link. */
  control: ReactNode | null;
  /** With no control, the remedy that opens the guest in place, worded. */
  openLabel: string | null;
  /** The opened guest already offers the control (its waiver block sends it). */
  panelHoldsControl?: boolean;
  /** Undo arrival alongside a separate remedy, when this guest is already here. */
  arrivalControl?: ReactNode;
  panelHoldsArrival?: boolean;
  /** The list's first fix: the one primary button on it. */
  primary: boolean;
};

export type FixListSection = {
  key: string;
  label: string;
  tone: "danger" | "default";
  /** Everyone fine, folded into one line of names until it is opened. */
  folded?: { names: string; mark: "success" | "none" };
  /**
   * Everyone fine as one counted line ("8 guests are ready"), whose toggle
   * ("All guests") lists them under it.
   */
  summary?: { label: string; phrase: string | null; toggle: string; rows: FixListRow[] };
  /** A card with no heading: the summary line and what follows it say it all. */
  headless?: boolean;
  /** Quiet lines at the card's foot ("Crew and plan are set"). */
  after?: ReactNode;
  /** One message to the whole group ("Ask all 3"), beside its count. Never a record. */
  action?: ReactNode;
  rows: FixListRow[];
};

const PHRASE_TONE = {
  danger: "text-danger",
  warning: "text-warning-strong",
  muted: "text-muted",
} as const;

/**
 * **The guest list as a fix list** (ADR 20261117-trip-page-clock): who can't
 * board yet, each with the one button that fixes it; who is worth a minute;
 * at Check-in who is still to come, each with Check in; and everyone else
 * folded into one line. Tapping a name opens that guest in place: the rest of
 * the page stays put, one guest is open at a time, and the open guest is in
 * the URL (`#booking-…`), so a refused action lands back on them.
 *
 * Opening a guest never performs a booking, arrival or presence action.
 */
export function GuestFixList({
  sections,
  guests,
  top,
  addGuest,
  initialOpenId,
  copy,
}: {
  sections: FixListSection[];
  guests: FixListGuest[];
  /** Above the groups: the desk's bar at Check-in. */
  top?: ReactNode;
  /** Where "Add a guest" goes; `headerOf` names the group whose heading row carries it. */
  addGuest?: { href: string; label: string; headerOf?: string } | null;
  initialOpenId?: string;
  copy: { close: string };
}) {
  const known = new Set(guests.map((guest) => guest.id));
  const [openId, setOpenId] = useState<string | null>(
    initialOpenId && known.has(initialOpenId) ? initialOpenId : null,
  );
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());

  // The guests' ids, not the array's identity: a refresh draws a new array.
  const ids = guests.map((guest) => guest.id).join(" ");

  // A deep link (`#booking-…`, `#move-booking-…`) opens that guest.
  useEffect(() => {
    const listed = new Set(ids.split(" "));
    const readHash = () => {
      const match = window.location.hash.match(/^#(?:move-)?booking-(.+)$/);
      if (match?.[1] && listed.has(match[1])) setOpenId(match[1]);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [ids]);

  // A refused action names its guest again (`bid`), and the list reopens them.
  useEffect(() => {
    if (initialOpenId && ids.split(" ").includes(initialOpenId)) setOpenId(initialOpenId);
  }, [initialOpenId, ids]);

  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    const url = new URL(window.location.href);
    url.hash = next ? `booking-${next}` : "roster";
    window.history.replaceState(window.history.state, "", url);
    if (next) {
      window.requestAnimationFrame?.(() =>
        document.getElementById(`booking-${next}`)?.scrollIntoView?.({ block: "nearest" }),
      );
    }
  };
  const byId = new Map(guests.map((guest) => [guest.id, guest]));
  const lastFolded = sections.findLast((section) => section.folded && section.rows.length)?.key;
  const drawn = (section: FixListSection) =>
    section.rows.length > 0 || (section.summary?.rows.length ?? 0) > 0 || Boolean(section.after);
  const addInHeader = sections.find(
    (section) =>
      section.key === addGuest?.headerOf && !section.folded && !section.headless && drawn(section),
  )?.key;

  return (
    <div
      data-guest-folios
      data-guest-folio={openId ?? undefined}
      className="space-y-6 sm:space-y-8"
    >
      {top}
      {sections.map((section) => {
        const summaryRows = section.summary?.rows ?? [];
        if (section.rows.length === 0 && summaryRows.length === 0 && !section.after) return null;
        const holdsOpen = [...section.rows, ...summaryRows].some(
          (row) => openId && row.guestIds.includes(openId),
        );
        const expanded = !section.folded || holdsOpen || unfolded.has(section.key);
        const summaryOpen = holdsOpen || unfolded.has(`${section.key}:summary`);
        const unfold = (key: string) =>
          setUnfolded((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        // People, not reasons: a guest is on one row.
        const people = [...section.rows, ...summaryRows].filter((row) => !row.title).length;
        const rowList = (rows: FixListRow[], className = "") => (
          <ul className={`divide-y divide-border ${className}`}>
            {rows.map((row) => (
              <FixRow
                key={row.key}
                row={row}
                byId={byId}
                openId={openId}
                toggle={toggle}
                closeLabel={copy.close}
              />
            ))}
          </ul>
        );
        return (
          <section
            key={section.key}
            aria-label={section.label}
            data-fix-group={section.key}
            className={sectionCardClass({ padding: "none", className: "overflow-hidden" })}
          >
            {section.folded ? (
              <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
                <button
                  type="button"
                  data-fix-fold={section.key}
                  aria-expanded={expanded}
                  onClick={() => unfold(section.key)}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-start focus-visible:focus-ring-inset"
                >
                  {section.folded.mark === "success" ? (
                    <StatusMark variant="success" size="md" className="shrink-0" />
                  ) : null}
                  <span className="min-w-0">
                    <span className="font-semibold">{section.label}</span>
                    <span className="text-muted"> · {section.folded.names}</span>
                  </span>
                </button>
                {addGuest && section.key === lastFolded ? (
                  <a
                    href={addGuest.href}
                    className={buttonClass({ variant: "link", size: "sm", flush: true })}
                  >
                    {addGuest.label}
                  </a>
                ) : null}
              </div>
            ) : section.headless ? null : (
              <div className="flex items-baseline justify-between gap-4 px-4 pt-4 pb-1 sm:px-6">
                <h3
                  className={`font-semibold ${section.tone === "danger" ? "text-danger" : "text-foreground"}`}
                >
                  {section.label}
                  {/* With "Add a guest" on the row, the count sits by its heading. */}
                  {section.key === addInHeader ? (
                    <span className="ms-2 text-sm font-normal text-muted tabular-nums">
                      {people || null}
                    </span>
                  ) : null}
                </h3>
                <span className="flex items-center gap-3">
                  {section.action}
                  {addGuest && section.key === addInHeader ? (
                    <a
                      href={addGuest.href}
                      className={buttonClass({ variant: "link", size: "sm", flush: true })}
                    >
                      {addGuest.label}
                    </a>
                  ) : (
                    <span className="text-sm text-muted tabular-nums">{people || null}</span>
                  )}
                </span>
              </div>
            )}
            {section.summary && summaryRows.length > 0 ? (
              <div className="border-b border-border last:border-b-0">
                <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
                  <StatusMark variant="success" size="md" className="shrink-0" />
                  <p className="min-w-0 flex-1">
                    <span className="font-semibold">{section.summary.label}</span>
                    {section.summary.phrase ? (
                      <span className="text-muted"> · {section.summary.phrase}</span>
                    ) : null}
                  </p>
                  <button
                    type="button"
                    data-fix-fold={`${section.key}:summary`}
                    aria-expanded={summaryOpen}
                    onClick={() => unfold(`${section.key}:summary`)}
                    className={buttonClass({ variant: "link", size: "sm", flush: true })}
                  >
                    {section.summary.toggle}
                  </button>
                </div>
                {summaryOpen ? rowList(summaryRows, "border-t border-border") : null}
              </div>
            ) : null}
            {expanded && section.rows.length > 0
              ? rowList(section.rows, section.folded ? "border-t border-border" : "")
              : null}
            {section.after ? (
              <div className="divide-y divide-border border-t border-border first:border-t-0">
                {section.after}
              </div>
            ) : null}
          </section>
        );
      })}
      {addGuest && !lastFolded && !addInHeader ? (
        <a href={addGuest.href} className={buttonClass({ variant: "link", flush: true })}>
          {addGuest.label}
        </a>
      ) : null}
    </div>
  );
}

function FixRow({
  row,
  byId,
  openId,
  toggle,
  closeLabel,
}: {
  row: FixListRow;
  byId: ReadonlyMap<string, FixListGuest>;
  openId: string | null;
  toggle: (id: string) => void;
  closeLabel: string;
}) {
  const phrase = row.phrase ? (
    <span className={`block text-sm ${PHRASE_TONE[row.tone]}`}>{row.phrase}</span>
  ) : null;
  if (row.title) {
    return (
      <li data-trip-fix={row.key} className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <StatusMark
          variant={row.tone === "danger" ? "danger" : "warning"}
          size="md"
          className="shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{row.title}</span>
          {phrase}
        </span>
        {row.control ? <div className="shrink-0">{row.control}</div> : null}
      </li>
    );
  }
  const id = row.guestIds[0];
  const guest = id ? byId.get(id) : undefined;
  if (!id || !guest) return null;
  const open = openId === id;
  return (
    <li
      id={`booking-${id}`}
      data-guest-row={id}
      className={`scroll-mt-24 ${open ? "bg-primary-tint" : ""}`}
    >
      <div
        className={`flex items-center gap-3 px-4 py-2 sm:px-6 ${row.arrivalControl && !open ? "flex-wrap sm:flex-nowrap" : ""}`}
      >
        <button
          type="button"
          data-guest-open={id}
          aria-expanded={open}
          aria-controls={`guest-panel-${id}`}
          aria-labelledby={`guest-name-${id}`}
          aria-describedby={row.phrase ? `guest-phrase-${id}` : undefined}
          onClick={() => toggle(id)}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg text-start focus-visible:focus-ring-inset"
        >
          <PersonAvatar name={guest.name} photoPath={guest.photoPath} size="sm" />
          <span className="min-w-0">
            <span id={`guest-name-${id}`} className="block font-semibold [overflow-wrap:anywhere]">
              {guest.name}
            </span>
            {row.phrase ? (
              <span id={`guest-phrase-${id}`} className={`block text-sm ${PHRASE_TONE[row.tone]}`}>
                {row.phrase}
              </span>
            ) : null}
          </span>
        </button>
        <div
          className={`flex shrink-0 items-center gap-2 ${row.arrivalControl && !open ? "basis-full justify-end sm:basis-auto" : ""}`}
        >
          {!open ? row.arrivalControl : null}
          {open ? (
            <button
              type="button"
              onClick={() => toggle(id)}
              className={buttonClass({ variant: "link", size: "sm" })}
            >
              {closeLabel}
            </button>
          ) : (
            (row.control ??
            (row.openLabel ? (
              <button
                type="button"
                onClick={() => toggle(id)}
                className={buttonClass({
                  variant: row.primary ? "primary" : "secondary",
                  size: "sm",
                })}
              >
                {row.openLabel}
              </button>
            ) : null))
          )}
        </div>
      </div>
      {open ? (
        <div id={`guest-panel-${id}`} className="border-t border-border px-4 pt-4 pb-5 sm:px-6">
          {row.control && !row.panelHoldsControl ? <div className="mb-4">{row.control}</div> : null}
          {row.arrivalControl && !row.panelHoldsArrival ? (
            <div className="mb-4">{row.arrivalControl}</div>
          ) : null}
          {guest.panel}
        </div>
      ) : null}
    </li>
  );
}
