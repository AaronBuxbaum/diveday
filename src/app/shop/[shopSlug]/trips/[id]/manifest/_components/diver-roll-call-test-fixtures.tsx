import { render } from "@testing-library/react";
import { vi } from "vitest";
import { DIVER_LOCALES, type DiverLocale } from "@/i18n/settings";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint, RollCallRecord, TripManifest } from "@/lib/manifests";
import { DiverRollCall } from "./DiverRollCall";
import type { DiverRollCallContext } from "./diver-roll-call-context";

/**
 * **One departure's diver roll call, drawn the way the manifest draws it** —
 * the fixtures every `DiverRollCall` part's test file renders through, so each
 * part is tested in its own file against the same list.
 */

/** The two staff languages, English first, from the one list of locales. */
const [ENGLISH, SPANISH] = DIVER_LOCALES;
export const t = staffTranslator(ENGLISH);
export const TRANSLATORS: Record<DiverLocale, StaffTranslator> = {
  [ENGLISH]: t,
  [SPANISH]: staffTranslator(SPANISH),
};
export type TestLocale = DiverLocale;

export function diver(
  overrides: Partial<TripManifest["divers"][number]> = {},
): TripManifest["divers"][number] {
  return {
    bookingId: "00000000-0000-4000-8000-000000000001",
    fullName: "Meera Iyer",
    email: null,
    emergencyContactName: "Asha Iyer",
    emergencyContactPhone: "+1-305-555-0231",
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "own_kit" },
    nitroxRequested: false,
    checkedIn: false,
    buddyTeam: null,
    buddyAlert: null,
    ...overrides,
  } as TripManifest["divers"][number];
}

export function boardedAt(): RollCallRecord {
  return {
    state: "boarded",
    occurredAt: new Date("2026-09-11T12:22:00.000Z"),
    recordedByName: "Keiko Tanaka",
  } as RollCallRecord;
}

export function notBackAt(): RollCallRecord {
  return {
    state: "not_boarded",
    occurredAt: new Date("2026-09-11T12:29:00.000Z"),
    recordedByName: "Keiko Tanaka",
  } as RollCallRecord;
}

export function renderList({
  divers,
  checkpoint = "after_dive_1",
  locale = ENGLISH,
  exceedsNoDecoLimits,
  crew = [],
}: {
  divers: TripManifest["divers"];
  checkpoint?: RollCallCheckpoint;
  /** Both locales, for the copy this list is the on-screen guarantee for. */
  locale?: TestLocale;
  exceedsNoDecoLimits?: boolean;
  crew?: TripManifest["crew"];
}) {
  return render(
    <DiverRollCall
      context={{
        divers,
        crew,
        checkpoint,
        isDeparture: checkpoint === "departure",
        exceedsNoDecoLimits,
        shopSlug: "blue-mantis",
        tripId: "00000000-0000-4000-8000-0000000000ff",
        locale,
        timezone: "America/New_York",
        notesByBooking: new Map(),
        rollCallAction: vi.fn(async () => ({ ok: true }) as const),
        addPrivateNoteAction: vi.fn(async () => undefined) as never,
        startMissingDiverReport: null,
        rollCallButtonCopy: () => ({ errorRefusal: "Try again", blockedMessage: "Still blocked" }),
        buddyTeamLabel: () => null,
        t: TRANSLATORS[locale],
      }}
    />,
  );
}

/** Every element the screen paints in the app's danger hue at rest. */
export function hiddenAtRest(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.classList.contains("hidden")) return true;
  }
  return false;
}

export function dangerToned(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[class]")].filter(
    (element) =>
      /(^|[\s:/])(text|bg|border|ring|from|to|via)-danger(\b|-)/.test(element.className) &&
      !hiddenAtRest(element),
  );
}

/** The exception control, wherever in the row it happens to be. */
export function exceptionControl(row: HTMLElement, name: string) {
  return [...row.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
}

/** A whole `DiverRollCallContext` for rendering one of the row's parts directly. */
export function diverContext(overrides: Partial<DiverRollCallContext> = {}): DiverRollCallContext {
  return {
    divers: [],
    crew: [],
    checkpoint: "after_dive_1",
    isDeparture: false,
    shopSlug: "blue-mantis",
    tripId: "00000000-0000-4000-8000-0000000000ff",
    locale: ENGLISH,
    timezone: "America/New_York",
    notesByBooking: new Map(),
    rollCallAction: vi.fn(async () => ({ ok: true }) as const),
    addPrivateNoteAction: vi.fn(async () => undefined) as never,
    startMissingDiverReport: null,
    rollCallButtonCopy: () => ({ errorRefusal: "Try again", blockedMessage: "Still blocked" }),
    buddyTeamLabel: () => null,
    t,
    ...overrides,
  };
}
