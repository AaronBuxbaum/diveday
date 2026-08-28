"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";

/**
 * **The ledger's toolbar** — ADR 20260827-clearwater-surface-language,
 * decision 7: "the five-control filter card demotes to a toolbar — one search
 * field, two quiet selects".
 *
 * What it replaces was a bordered card holding a four-column `FieldGrid`
 * (status, diver, range, from, to) with an Apply button and a Clear link — a
 * panel as tall as five orders, sitting above the orders, on a page whose
 * subject is the orders. The date pair is the one control that stays
 * conditional: it renders only on a custom range, which is either what a
 * Reports link arrived with or what the reader just chose, so the resting
 * toolbar is three controls and a count.
 *
 * **Apply-on-change, and therefore no Apply button.** A select applies when it
 * changes; the search box applies after a short pause, the same 300ms the
 * counter's search uses so a fast typist is not navigating per keystroke.
 * `QueryForm` keeps this a real GET form — a submit landing before hydration
 * still works — and turns the hydrated submit into a router navigation, which
 * is what stops a filter tap throwing the reader back to the top of the page
 * (`e2e/scroll-preservation.spec.ts`).
 *
 * The labels are `sr-only`: each control states its own current value ("All
 * statuses", "Last 90 days"), so a visible caption above it would be the
 * caption restating its heading that copy-restraint deletes — but the
 * accessible name is not the sighted reader's convenience and stays.
 */
export type OrdersToolbarCopy = {
  searchLabel: string;
  searchPlaceholder: string;
  statusLabel: string;
  statusAll: string;
  /** Every status the enum carries, already worded. */
  statuses: ReadonlyArray<{ value: string; label: string }>;
  rangeLabel: string;
  rangeRecent: string;
  rangeAll: string;
  rangeCustom: string;
  fromLabel: string;
  toLabel: string;
  clear: string;
  /** "156 orders" — the whole filtered set, not this page's slice. */
  count: string;
};

/** How long the search box waits after the last keystroke before it applies. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * One control's box. On a phone the selects share a line rather than each
 * taking a full-width row under the search box — five stacked rows is the
 * filter card this replaces, wearing a different border.
 */
const FIELD_CLASS = "min-w-36 flex-1 sm:w-44 sm:flex-none";

export function OrdersToolbar({
  q,
  status,
  range,
  from,
  to,
  personId,
  tripId,
  clearHref,
  copy,
}: {
  q: string;
  status: string;
  /** `recent` · `all` · `custom` — authoritative, and what decides the date pair. */
  range: "recent" | "all" | "custom";
  from: string;
  to: string;
  /**
   * The two filters that arrive from a link rather than from a control here —
   * the diver record's and the trip pulse's. They ride as hidden fields so
   * changing the status does not silently widen the list back out to the whole
   * shop, which is what this form's missing `personId` used to do.
   */
  personId?: string;
  tripId?: string;
  /**
   * The way back out, or nothing when there is no filter to drop. It is a link
   * rather than a control in the form because two of the filters — the pinned
   * diver and the pinned departure — have no control here to reset.
   */
  clearHref?: string;
  copy: OrdersToolbarCopy;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const clearSearchTimer = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
  }, []);

  useEffect(() => {
    setHydrated(true);
    return clearSearchTimer;
  }, [clearSearchTimer]);

  const submit = () => formRef.current?.requestSubmit();

  function applySearchOnInput(event: FormEvent<HTMLInputElement>) {
    clearSearchTimer();
    const value = event.currentTarget.value.trim();
    if (value === q) return;
    searchTimerRef.current = setTimeout(submit, SEARCH_DEBOUNCE_MS);
  }

  return (
    <QueryForm
      ref={formRef}
      onSubmitCapture={clearSearchTimer}
      className="mt-6 flex flex-wrap items-center gap-3"
    >
      {personId ? <input type="hidden" name="personId" value={personId} /> : null}
      {tripId ? <input type="hidden" name="tripId" value={tripId} /> : null}

      {/* Each control is sized by its own wrapper rather than by a width class
          appended to `controlClass`: that class already sets `w-full`, and
          Tailwind emits width utilities in its own order rather than the order
          they were written, so a `w-auto` beside it would win or lose by
          accident (AGENTS.md's `buttonClass` warning). The wrapper decides the
          box; the control fills it. */}
      <div className="w-full sm:w-80">
        <label className="sr-only" htmlFor="orders-search">
          {copy.searchLabel}
        </label>
        <input
          id="orders-search"
          name="q"
          type="search"
          inputMode="search"
          defaultValue={q}
          placeholder={copy.searchPlaceholder}
          maxLength={120}
          onInput={applySearchOnInput}
          // The e2e suite waits on this before relying on type-to-apply — the
          // deterministic signal that the handler above is live.
          data-hydrated={hydrated ? "true" : undefined}
          className={controlClass}
        />
      </div>

      <div className={FIELD_CLASS}>
        <label className="sr-only" htmlFor="orders-status">
          {copy.statusLabel}
        </label>
        <select
          id="orders-status"
          name="status"
          defaultValue={status}
          onChange={submit}
          className={controlClass}
        >
          <option value="">{copy.statusAll}</option>
          {copy.statuses.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* "Custom dates" is always offered, unlike the card this replaces, where
          it appeared only once a link had already set the bounds — so with the
          date inputs now conditional there would otherwise be no way into a
          custom range at all. Choosing it submits `range=custom` with no
          bounds, which filters nothing and renders the two date inputs. */}
      <div className={FIELD_CLASS}>
        <label className="sr-only" htmlFor="orders-range">
          {copy.rangeLabel}
        </label>
        <select
          id="orders-range"
          name="range"
          defaultValue={range}
          onChange={submit}
          className={controlClass}
        >
          <option value="recent">{copy.rangeRecent}</option>
          <option value="all">{copy.rangeAll}</option>
          <option value="custom">{copy.rangeCustom}</option>
        </select>
      </div>

      {range === "custom" ? (
        <>
          <div className={FIELD_CLASS}>
            <label className="sr-only" htmlFor="orders-from">
              {copy.fromLabel}
            </label>
            <input
              id="orders-from"
              type="date"
              name="from"
              defaultValue={from}
              onChange={submit}
              className={controlClass}
            />
          </div>
          <div className={FIELD_CLASS}>
            <label className="sr-only" htmlFor="orders-to">
              {copy.toLabel}
            </label>
            <input
              id="orders-to"
              type="date"
              name="to"
              defaultValue={to}
              onChange={submit}
              className={controlClass}
            />
          </div>
        </>
      ) : null}

      {clearHref ? (
        <Link
          href={clearHref}
          scroll={false}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.clear}
        </Link>
      ) : null}

      <p className="ms-auto text-sm text-muted tabular-nums">{copy.count}</p>
    </QueryForm>
  );
}
