"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormDraftProps } from "@/components/FormDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ForgivingInput } from "@/components/ui/ForgivingInput";
import { DateField, Field, FieldGrid } from "@/components/ui/form";
import { groupLabelClass } from "@/components/ui/ledger";
import { fill, pluralForm } from "@/i18n/fill";
import { shiftCalendarDate } from "@/lib/calendar-date";
import type { MovePreflight, MovePreflightSection } from "@/lib/move-preflight";
import { AddPanel, type AddPanelBuilder } from "./AddPanel";
import type {
  BuilderActions,
  BuilderCopy,
  BuilderInitialCourse,
  BuilderInitialSite,
  BuilderMoreOptions,
  BuilderOptions,
  BuilderPattern,
  BuilderPriceInput,
  BuilderRequestPlan,
  BuilderTideWindowInput,
} from "./builder-types";
import { focusOnMount } from "./focus-on-mount";
import type { BuilderWeek, WeekDeparture } from "./WeekBoard";
import { WeekBoard } from "./WeekBoard";

export type {
  BuilderBoatOption,
  BuilderCopy,
  BuilderCourseOption,
  BuilderInitialCourse,
  BuilderInitialSite,
  BuilderMoreOptions,
  BuilderOption,
  BuilderOptions,
  BuilderPattern,
  BuilderPriceInput,
  BuilderRequestPlan,
  BuilderTideWindowInput,
  DiveMode,
} from "./builder-types";

/**
 * A week-grid departure as the shared move/copy/remove panels want it —
 * a day cell or a spanning course bar alike, which is why the grid states them
 * as one type.
 */
function panelTripOf(departure: WeekDeparture): PanelTrip {
  return {
    id: departure.tripId,
    title: departure.title,
    dateIso: departure.dateIso,
    startTime: departure.startTime,
    dayCount: departure.dayCount,
  };
}

/** The little a move/copy/remove panel needs to know about its departure. */
type PanelTrip = {
  id: string;
  title: string;
  dateIso: string;
  startTime: string;
  dayCount: number;
};

/**
 * Take a departure off the board. Two deliberate steps: the row menu's
 * "Remove" only discloses this, and this holds the only real submit.
 *
 * Module scope, and shared by both compositions — the vertical day stream and
 * the `xl` week grid render the same three panels, so a change to a refusal or
 * a field lands in one place rather than in two that drift.
 */
function RemovePanel({
  trip,
  copy,
  action,
  onCancel,
}: {
  trip: PanelTrip;
  copy: BuilderCopy;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  action: (formData: FormData) => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <form
      action={action}
      className="mt-3 rounded-inset border border-danger/30 bg-danger/5 p-4 animate-scale-in"
    >
      <input type="hidden" name="tripId" value={trip.id} />
      <p className="text-sm" role="alert">
        {fill(copy.removeConfirm, { title: trip.title })}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel={copy.removePending}
          className={buttonClass({ variant: "danger", size: "sm" })}
        >
          {copy.removeConfirmButton}
        </SubmitButton>
        {/* Focus lands on the way back out, as Move's and Copy's lands on
            their first field: the "⋯" list that opened this unmounts, and
            focus left with it would fall to the top of the page. The safe
            answer rather than the destructive one, so an Enter pressed out of
            habit keeps the trip. */}
        <button
          type="button"
          ref={focusOnMount}
          onClick={onCancel}
          className={buttonClass({ variant: "ghost" })}
        >
          {copy.removeCancel}
        </button>
      </div>
    </form>
  );
}

/**
 * **What moving this departure will cost**, above the two fields that would do
 * it (issue #1203, D43).
 *
 * Fetched when the panel mounts rather than shipped with the board: a page of
 * departures times seven counts, for panels that are all closed, is a query
 * bill nobody asked for — the same reasoning the add panel's selects already
 * follow (`loadOptions`).
 *
 * **Nothing at all while it loads, and nothing at all when there is nothing to
 * say.** No skeleton and no spinner: the block is one to four short lines, and
 * a placeholder for them would be more furniture than the thing it stands in
 * for. It sits above the fields because a consequence a reader meets *after*
 * the button they are reaching for has not been read; the date input takes
 * focus on mount, so the shift lands before there is any pointer target to
 * miss.
 *
 * Read-only end to end — see `src/lib/move-preflight.ts`.
 */
function MoveImpact({
  tripId,
  target,
  copy,
  loadPreflight,
}: {
  tripId: string;
  /**
   * Where the fields say the departure is going, or null while they say where
   * it already is (which is how the panel opens) or hold no complete pair at
   * all. Only the two crew lines depend on it — see `getMovePreflight`.
   */
  target: { date: string; startTime: string } | null;
  copy: BuilderCopy;
  loadPreflight: (
    tripId: string,
    target: { date: string; startTime: string } | null,
  ) => Promise<MovePreflight | null>;
}) {
  const [preflight, setPreflight] = useState<MovePreflight | null>(null);
  // Destructured, because `target` is a fresh object on every render of the
  // panel: depending on it would re-read on each keystroke anywhere in the
  // form, and the two strings are the whole of what the answer turns on.
  const targetDate = target?.date ?? null;
  const targetTime = target?.startTime ?? null;
  // The newest `loadPreflight`, read when asking rather than subscribed to:
  // every server action on this page refreshes the route (the session read
  // re-sets its cookie cache), which hands in a fresh function object, so a
  // dependency on it re-asked after each answer and a panel left open polled
  // the server without end (issues #2197, #2223).
  const ask = useEffectEvent((id: string, to: { date: string; startTime: string } | null) =>
    loadPreflight(id, to),
  );
  useEffect(() => {
    let live = true;
    ask(tripId, targetDate && targetTime ? { date: targetDate, startTime: targetTime } : null).then(
      (result) => {
        // `live` is what makes the re-read safe: a staff member picking three
        // dates in a row has three requests in flight, and without this the
        // slowest one wins whichever it was. The cleanup runs before each new
        // effect, so only the newest can still write.
        if (live) setPreflight(result);
      },
      // A failed read leaves the panel exactly as it was before this existed —
      // two fields and a button. A preview is a courtesy, never a gate.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [tripId, targetDate, targetTime]);

  if (!preflight) return null;
  // Two lists, split by severity — and split here rather than in
  // `composeMovePreflight`, because the section union already says which kind
  // is a reason to stop and a `severity` field would restate it in data.
  //
  // The crew clash is the one consequence the move *manufactures*: a person on
  // two overlapping departures is a state `setTripCrew`/`changeTripCrew` both
  // refuse outright, and it is the manifest the coastguard reads that prints
  // it twice. Issue #1345 asked whether `moveTrip` should refuse; the answer
  // was no — the owner assigns crew — but a line saying so in muted grey, at
  // the same weight as a gear count, is not the shop being told. So it wears
  // the blocked line's weight and is announced, without becoming a gate.
  //
  // `crewAway` deliberately stays in the muted list: a blackout is the crew
  // member's own note and informs, and the owner's answer named the clash.
  //
  // The boat clash (H-80, issue #1780) wears the same weight for the same
  // reason, and leads: one hull on two departures at once is the bigger fact.
  const isAlert = (section: MovePreflightSection) =>
    section.kind === "boat" || section.kind === "crew";
  const alertLines = preflight.sections.flatMap((section) =>
    isAlert(section) ? impactLines(section, copy) : [],
  );
  const lines = preflight.sections.flatMap((section) =>
    isAlert(section) ? [] : impactLines(section, copy),
  );
  if (lines.length === 0 && alertLines.length === 0 && !preflight.blocked) return null;

  return (
    <div className="sm:col-span-2 space-y-3" data-move-impact={tripId}>
      {preflight.blocked ? (
        <p className="text-sm font-medium text-warning" role="alert">
          {preflight.blocked === "already_sailed"
            ? copy.impactBlockedSailed
            : copy.impactBlockedNotScheduled}
        </p>
      ) : null}
      {/*
       * One `role="alert"` per person rather than one wrapping the set, so a
       * screen reader announces each name the way it announces the refusal
       * above — two clashing divemasters are two facts, not one paragraph.
       */}
      {alertLines.map((line) => (
        <p key={line} className="text-sm font-medium text-warning" role="alert">
          {line}
        </p>
      ))}
      {lines.length > 0 ? (
        <div>
          <p className={groupLabelClass("muted")}>{copy.impactTitle}</p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One section's sentences. The money section is the only one that can produce
 * two — the amount already taken, and the window that governs giving it back —
 * and the window is dropped entirely when the departure sets none.
 */
function impactLines(section: MovePreflightSection, copy: BuilderCopy): string[] {
  switch (section.kind) {
    // One line per person, which is why neither crew section has a plural
    // pair. A joined list would need a locale in a component that deliberately
    // takes every word preformatted, and naming them one at a time is the more
    // specific reading anyway — the whole point of #1310 is that a *count* of
    // crew told a reader nothing.
    //
    // The clash names the other departure too. Without it the reader has to
    // leave the panel to find out whether "another departure" is the 07:00 or
    // the 15:00, which is the question they opened the panel to settle.
    case "boat":
      return section.clashes.map((clash) =>
        fill(copy.impactBoatClash, { boat: clash.boat, departure: clash.departure }),
      );
    case "crew":
      return section.clashes.map((clash) =>
        fill(copy.impactCrewClash, { name: clash.name, departure: clash.departure }),
      );
    case "crewAway":
      return section.names.map((name) => fill(copy.impactCrewAway, { name }));
    case "told":
      return [
        fill(
          pluralForm(section.reminded, { one: copy.impactToldOne, other: copy.impactToldOther }),
          {
            count: section.reminded,
          },
        ),
      ];
    case "gear":
      return [
        fill(pluralForm(section.count, { one: copy.impactGearOne, other: copy.impactGearOther }), {
          count: section.count,
        }),
      ];
    case "money": {
      const paid = fill(
        pluralForm(section.paid, { one: copy.impactPaidOne, other: copy.impactPaidOther }),
        { count: section.paid },
      );
      const hours = section.cancellationWindowHours;
      if (hours === null) return [paid];
      return [
        paid,
        fill(pluralForm(hours, { one: copy.impactWindowOne, other: copy.impactWindowOther }), {
          count: hours,
        }),
      ];
    }
  }
}

/** Slide a departure to another day or time; a multi-day course moves as a block. */
function MovePanel({
  locale,
  trip,
  copy,
  action,
  loadPreflight,
  onCancel,
}: {
  /** The reader's language, for the time fields' readings. */
  locale: string;
  trip: PanelTrip;
  copy: BuilderCopy;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  action: (formData: FormData) => void | Promise<void>;
  loadPreflight: (
    tripId: string,
    target: { date: string; startTime: string } | null,
  ) => Promise<MovePreflight | null>;
  onCancel: () => void;
}) {
  // **The date and the time are state here only because two lines of the
  // preview depend on them** (issue #1310): whether this boat's crew are
  // already on another whose window overlaps where this one is going, and
  // whether any of them said they are away then. Everything else the panel
  // shows is a property of the departure and the same wherever it lands.
  //
  // The *time* matters as much as the date, which is why it is state too: a
  // morning boat and an afternoon boat on one day are an ordinary double
  // shift, and only an overlap is a problem — the same rule `setTripCrew`
  // refuses on.
  //
  // `onChange` rather than a debounce: a `date` or `time` input publishes a
  // value only once all its segments are filled, so a staff member picking one
  // produces one read, not one per keystroke. The pair the departure already
  // sits on reads as no target at all — moving a boat to where it is changes
  // nothing, and a standing double-booking there is the staffing week's
  // problem rather than this panel's.
  const [date, setDate] = useState(trip.dateIso);
  const [startTime, setStartTime] = useState(trip.startTime);
  const unchanged = date === trip.dateIso && startTime === trip.startTime;
  const target = date && startTime && !unchanged ? { date, startTime } : null;
  return (
    <FieldGrid
      as="form"
      action={action}
      columns={2}
      className="mt-3 rounded-inset border border-border bg-surface-sunken/50 p-4 gap-y-4 animate-scale-in"
    >
      <input type="hidden" name="tripId" value={trip.id} />
      <MoveImpact tripId={trip.id} target={target} copy={copy} loadPreflight={loadPreflight} />
      <Field
        label={copy.newDate}
        description={
          trip.dayCount > 1 ? fill(copy.multiDayNote, { count: trip.dayCount }) : undefined
        }
      >
        <DateField
          name="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
          ref={focusOnMount}
        />
      </Field>
      <Field label={copy.newDepartureTime}>
        <ForgivingInput
          kind="time"
          name="startTime"
          required
          defaultValue={trip.startTime}
          locale={locale}
          copy={{ typedAs: copy.typedAs }}
          onCanonicalChange={setStartTime}
        />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton pendingLabel={copy.moving} className={buttonClass()}>
          {copy.moveIt}
        </SubmitButton>
        <button type="button" onClick={onCancel} className={buttonClass({ variant: "ghost" })}>
          {copy.cancel}
        </button>
      </div>
    </FieldGrid>
  );
}

/** Mint the same departure on another day — same seats, same price, no roster. */
function CopyPanel({
  locale,
  trip,
  copy,
  action,
  onCancel,
}: {
  /** The reader's language, for the time fields' readings. */
  locale: string;
  trip: PanelTrip;
  copy: BuilderCopy;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  action: (formData: FormData) => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <FieldGrid
      as="form"
      action={action}
      columns={2}
      className="mt-3 rounded-inset border border-border bg-surface-sunken/50 p-4 gap-y-4 animate-scale-in"
    >
      <input type="hidden" name="tripId" value={trip.id} />
      <Field label={copy.copyTo} description={copy.copyDescription}>
        <DateField
          name="date"
          required
          defaultValue={shiftCalendarDate(trip.dateIso, 7)}
          ref={focusOnMount}
        />
      </Field>
      <Field label={copy.departureTime}>
        <ForgivingInput
          kind="time"
          name="startTime"
          required
          defaultValue={trip.startTime}
          locale={locale}
          copy={{ typedAs: copy.typedAs }}
        />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton pendingLabel={copy.copying} className={buttonClass()}>
          {copy.copyIt}
        </SubmitButton>
        <button type="button" onClick={onCancel} className={buttonClass({ variant: "ghost" })}>
          {copy.cancel}
        </button>
      </div>
    </FieldGrid>
  );
}

/**
 * The staff schedule board, as a builder rather than a list.
 *
 * Departures sit under the shop-local day they sail on, and each row's actions —
 * slide it to another day or time, copy it forward, take it back off the board —
 * sit behind one quiet "⋯" disclosure per row, so the board at rest is the
 * schedule, not a grid of buttons. "Add a departure" opens under whichever day header the
 * staff member pressed it on, pre-dated to that day, so putting a second boat on
 * Thursday is one click and a title rather than a trip through a full form.
 *
 * Only one panel is open at a time. That is not just tidiness: every panel is a
 * separate `<form>` posting a whole edit, and two open at once invites a staff
 * member to fill in both and lose the one they didn't submit.
 *
 * Everything past when-and-how-many — dives, sites, requirements, crew,
 * conditions, prices, the roster — stays on the trip's own page, one click away
 * on the title. This surface is deliberately shallow.
 */

/**
 * **Two add keys, not one prefix.** The header's panel is `add:top` and a
 * day's is `w:add:<dateIso>`. One prefix covered both while the day stream
 * existed, because its own per-day keys were `add:<dateIso>`; deleting it
 * (#1923) left `startsWith("add:")` matching only the header's, so a day's
 * panel opened onto selects that said "Loading…" for the rest of the visit.
 */
const isAddKey = (key: string | null) => key === "add:top" || (key?.startsWith("w:add:") ?? false);

export function ScheduleBuilder({
  shopSlug,
  locale,
  addDraft = null,
  loadPattern,
  loadTideWindow,
  loadMovePreflight,
  loadOptions,
  price,
  actions,
  defaultDateIso,
  canConfigure,
  copy,
  more,
  initialCourse,
  initialSite,
  requestPlan,
  openAdd,
  week,
}: {
  shopSlug: string;
  /** The reader's language, for the forgiving time fields' readings. */
  locale: string;
  /** The reader's fresh add-panel draft, applied when a panel opens. */
  addDraft?: FormDraftProps["draft"];
  /** The weekday's usual departure, fetched when a panel opens with no draft. */
  loadPattern?: (dateIso: string) => Promise<BuilderPattern | null>;
  /** The add panel's tide line for a chosen site (ADR 20260907-noaa-tide-predictions). */
  loadTideWindow?: (input: BuilderTideWindowInput) => Promise<string | null>;
  /** Fetches the add panel's course and dive-site options, first time it opens. */
  loadOptions: () => Promise<BuilderOptions>;
  /** The move panel's impact preview, fetched per departure when one opens. */
  loadMovePreflight: (
    tripId: string,
    target: { date: string; startTime: string } | null,
  ) => Promise<MovePreflight | null>;
  price: BuilderPriceInput;
  actions: BuilderActions;
  /** The soonest day on the board, for the "Add a departure" button in the header. */
  defaultDateIso: string;
  canConfigure: boolean;
  copy: BuilderCopy;
  more: BuilderMoreOptions;
  /** Set when the board was reached from a course's "schedule a session" control. */
  initialCourse: BuilderInitialCourse | null;
  /** Set when the board was reached from a dive site's "schedule departure" control. */
  initialSite?: BuilderInitialSite | null;
  /** Requests selected from the Requests page, or null for an ordinary add. */
  requestPlan?: BuilderRequestPlan | null;
  /**
   * Whether to arrive with the add panel already open, and how deep. Every
   * former door to `/trips/new` now lands here instead, and a link that used to
   * open a whole page of form has to open something.
   */
  openAdd: "closed" | "quick" | "expanded";
  /**
   * The same departures read as a seven-column week, for `xl` and up (ADR
   * 20260827-clearwater-surface-language, decision 5). Null on a board with
   * nothing upcoming at all, where the empty state stands at every width.
   */
  week?: BuilderWeek | null;
}) {
  // One of `add:<dateIso>`, `move:<tripId>`, `copy:<tripId>`, or null.
  const [open, setOpen] = useState<string | null>(openAdd === "closed" ? null : "add:top");

  // The top add panel is opened by *links* — the header's "Add a departure",
  // the empty board's call to action, the former /trips/new doors — all of
  // which land as a `?add=` client navigation to this same route. The state
  // initializer above only covers a fresh mount, so a prop change (same
  // component instance, new search params) has to open the panel too, or the
  // header link works exactly once.
  useEffect(() => {
    if (openAdd !== "closed") setOpen("add:top");
  }, [openAdd]);

  // Cancelling that panel mirrors the link that opened it: clear the opening
  // params so the same link opens it again, and hand focus back to the header
  // control (server-rendered, so reached by its data attribute rather than a
  // ref). Cursor/notice params survive — only what opened the panel goes.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cancelTopAdd = () => {
    setOpen(null);
    const params = new URLSearchParams(searchParams);
    for (const key of ["add", "date", "course", "requests", "site"]) params.delete(key);
    router.replace(`${pathname}${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
    document.querySelector<HTMLElement>("[data-board-add]")?.focus();
  };

  // The week grid's own disclosures, read back out of the one `open` key.
  // Everything the grid opens is prefixed `w:` so a control there hands focus
  // back to itself rather than to its identically-keyed twin in the stream,
  // which is `display:none` at this width and cannot take focus at all.
  // **Spans as well as cells.** A multi-day course is drawn once, as a bar
  // across the days it owns, *instead of* the entries for those days — so if
  // the bar were left out of this lookup the desktop board would be the one
  // place in the app where a course cannot be moved, copied or removed at all.
  const weekDepartures: WeekDeparture[] = week
    ? [...week.days.flatMap((day) => day.entries), ...week.spans]
    : [];
  const weekAdd = open?.startsWith("w:add:") ? open.slice("w:add:".length) : null;
  /**
   * **The panel a disclosure opens, resolved once.** It renders under the row
   * that opened it (`WeekBoard`'s `panel`), never at the foot of the week.
   *
   * The `w:` prefix on the key is what is left of the two compositions this
   * board used to have (#1923). It is now redundant — there is one "⋯" button
   * per departure and it is always the week's — but it stays on the key rather
   * than being stripped, because it is also the focus-return address and
   * rewriting every key to drop two characters buys nothing.
   *
   * **Spans as well as cells.** A multi-day course is drawn once as a bar
   * across the days it owns, *instead of* the entries for those days, so a
   * lookup that missed spans would make the board the one place in the app
   * where a course cannot be moved, copied or removed at all.
   */
  const sharedPanel = ((): {
    kind: "move" | "copy" | "remove";
    trip: PanelTrip;
    /** The menu key the panel returns focus to when it closes. */
    closeKey: string;
  } | null => {
    if (!open) return null;
    for (const kind of ["move", "copy", "remove"] as const) {
      const prefix = `w:${kind}:`;
      if (!open.startsWith(prefix)) continue;
      const tripId = open.slice(prefix.length);
      const entry = weekDepartures.find((candidate) => candidate.tripId === tripId);
      if (entry) return { kind, trip: panelTripOf(entry), closeKey: `w:menu:${tripId}` };
    }
    return null;
  })();

  const toggle = (panel: string) => {
    setOpen((current) => (current === panel ? null : panel));
  };
  // A row's "⋯" list: choosing an act swaps the list for that act's panel,
  // and the list closes itself (outside tap, Escape) through
  // `useMenuDismissal` in `WeekBoard`. Stable, because that hook lists it.
  const chooseRowAction = useCallback((kind: "move" | "copy" | "remove", tripId: string) => {
    setOpen(`w:${kind}:${tripId}`);
  }, []);
  const closeRowMenu = useCallback(() => {
    setOpen((current) => (current?.startsWith("w:menu:") ? null : current));
  }, []);

  // The add panel's selects, fetched the first time any add panel opens and
  // kept for the rest of the visit — the catalogue does not change while a
  // staff member schedules a week. A failed fetch clears the guard so the next
  // open tries again rather than leaving the selects saying "Loading…" forever.
  const [options, setOptions] = useState<BuilderOptions | null>(null);
  const optionsRequested = useRef(false);
  useEffect(() => {
    if (!isAddKey(open) || optionsRequested.current) return;
    optionsRequested.current = true;
    loadOptions().then(setOptions, () => {
      optionsRequested.current = false;
    });
  }, [open, loadOptions]);

  // Every toggle button that can open a panel, keyed the same way `open` is,
  // so Cancel can hand keyboard focus back to the exact control that opened
  // it instead of leaving it on `<body>` when the panel unmounts.
  const toggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const registerToggle = (key: string) => (el: HTMLButtonElement | null) => {
    toggleRefs.current[key] = el;
  };
  const closePanel = (key: string) => {
    setOpen(null);
    toggleRefs.current[key]?.focus();
  };

  // The schedule route has no dynamic id, so if `cacheComponents: true`'s
  // Activity-based navigation is ever re-enabled, this instance could
  // otherwise be preserved across a navigate-away-and-back with a panel left
  // expanded and its defaults stale (docs ADR
  // 20260801-cache-components-activity-state, currently reverted, commit
  // 100fcf8). Reset on the leading edge of any (re)navigation, same pattern
  // as InlineConfirm.
  // Skipping the genuine first mount is load-bearing: effects run only after
  // hydration *completes*, but selective hydration lets a person open a panel
  // the moment its own button is interactive — so on a slow connection this
  // effect's initial run landed after their click and snapped the panel shut
  // (caught as a detached-mid-click flake in e2e/schedule-builder.spec.ts on
  // CI). A ref, not state: refs survive an Activity-preserved hide/re-show
  // while its effects re-run, so the re-show still resets — only the true
  // first mount is exempt. The race itself can't be scripted deterministically
  // (nothing schedules a click between commit and passive effects), which is
  // why no regression test accompanies this.
  //
  // It resets to *what the URL asks for*, not to null. Closing unconditionally
  // was not idempotent, and an effect that isn't gets run twice on every mount
  // in development (React StrictMode): first pass armed the ref, second pass
  // immediately shut the panel the first pass had just been told to open. That
  // took out every cross-route door to this form at once — the catalogue's
  // "schedule a session of this course", the `/trips/new` 308, a pasted
  // `?add=full` — each of which lands as a fresh mount carrying `openAdd`.
  // Re-deriving from `openAdd` makes a second run a no-op and still resets a
  // stale panel on a genuine re-navigation, which is what the reset is for.
  const pathnameEffectRan = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change re-derives the panel from the URL, which is the point.
  useEffect(() => {
    if (!pathnameEffectRan.current) {
      pathnameEffectRan.current = true;
      return;
    }
    setOpen(openAdd === "closed" ? null : "add:top");
  }, [pathname]);

  // What the top panel and every week-row panel share; each adds its own day.
  const addPanelBuilder: AddPanelBuilder = {
    locale,
    addDraft,
    draftActions: actions.draft,
    loadPattern,
    loadTideWindow,
    options,
    price,
    copy,
    more,
    onAdd: actions.add,
  };

  return (
    // `data-schedule-builder` is the copy-free hook a test asks "has the
    // board finished streaming?" with — true whether or not the week has
    // anything on it, which `data-week-board` is not. The `aria-label` beside
    // it is localised, so a Spanish run cannot name the region; that is the
    // same finding `data-day-stream` and `data-week-board` already carry
    // (#1923), and the Spanish visual captures are where it bites.
    <section data-schedule-builder="" aria-label={copy.ariaLabel} className="mb-8">
      {/* No top "Add a departure" band: that control lives in the page
          header's action cluster (a Link to `?add=1` in page.tsx) rather than
          holding a stratum of its own whose only content duplicated the "+
          Add" every day header already carries (principle 8/9). The panel it
          opens still renders here, keyed "add:top", via `openAdd`. */}

      {/* Creating a departure is owner/manager/instructor work (H-14); crew
          still read the board, so it says whose job this is rather than
          silently omitting every add control. */}
      {canConfigure ? null : (
        <p className="mb-3 rounded-inset border border-border bg-surface-sunken/50 p-4 text-sm text-muted">
          {copy.viewOnlyNotice}
        </p>
      )}

      {/* Keyed "add:top" rather than by its date: the header link and the
          first day's own "+ Add" would otherwise share a panel key and render
          two identical forms at once. */}
      {canConfigure && open === "add:top" ? (
        <AddPanel
          builder={addPanelBuilder}
          dateIso={defaultDateIso}
          initialCourse={initialCourse}
          initialSite={initialSite}
          requestPlan={requestPlan}
          startExpanded={openAdd === "expanded"}
          onCancel={cancelTopAdd}
        />
      ) : null}

      {/* **The standing "Usual crew: …" line is gone** — docs/design/surfaces.md
          listed it under the board's "Remove first" from the day the week grid
          shipped, and the `20260908-one-hand` canvas deletes it outright. It
          was a sentence at the top of the phone stream that named two people
          and was true of most rows, on a surface a manager opens to find the
          row it is *not* true of. `usualCrew` survives as what it always
          really was: the predicate that keeps a matching row's crew line off
          the row (`isUsualCrew` below), so what any row still prints about crew
          is, by construction, the exception. */}

      {/* The week. Every form it opens renders inside it, under the row or
          the day that opened it (`panel`): a move under its departure, a
          day's add under that day's boats. One node per open key, so what is
          typed into a panel's uncontrolled inputs survives anything that
          re-lays the rows around it. */}
      {week ? (
        <div className="mt-4">
          <WeekBoard
            week={week}
            canConfigure={canConfigure}
            shopSlug={shopSlug}
            openKey={open}
            onToggle={toggle}
            onChoose={chooseRowAction}
            onCloseMenu={closeRowMenu}
            registerToggle={registerToggle}
            panel={
              !canConfigure
                ? null
                : weekAdd
                  ? {
                      under: "day",
                      dateIso: weekAdd,
                      node: (
                        <AddPanel
                          builder={addPanelBuilder}
                          dateIso={weekAdd}
                          initialCourse={null}
                          requestPlan={null}
                          startExpanded={false}
                          onCancel={() => closePanel(`w:add:${weekAdd}`)}
                        />
                      ),
                    }
                  : sharedPanel
                    ? {
                        under: "departure",
                        tripId: sharedPanel.trip.id,
                        node: (
                          <>
                            {sharedPanel.kind === "move" ? (
                              <MovePanel
                                locale={locale}
                                trip={sharedPanel.trip}
                                copy={copy}
                                action={actions.move}
                                loadPreflight={loadMovePreflight}
                                onCancel={() => closePanel(sharedPanel.closeKey)}
                              />
                            ) : null}
                            {sharedPanel.kind === "copy" ? (
                              <CopyPanel
                                locale={locale}
                                trip={sharedPanel.trip}
                                copy={copy}
                                action={actions.duplicate}
                                onCancel={() => closePanel(sharedPanel.closeKey)}
                              />
                            ) : null}
                            {sharedPanel.kind === "remove" ? (
                              <RemovePanel
                                trip={sharedPanel.trip}
                                copy={copy}
                                action={actions.remove}
                                onCancel={() => closePanel(sharedPanel.closeKey)}
                              />
                            ) : null}
                          </>
                        ),
                      }
                    : null
            }
            copy={copy}
          />
        </div>
      ) : null}
    </section>
  );
}
