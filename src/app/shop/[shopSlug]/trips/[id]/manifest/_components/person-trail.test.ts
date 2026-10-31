import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import type { RollCallRecord, TripManifest } from "@/lib/manifests";
import type { PersonTrailEntry } from "./PersonSheet";
import { personTrailIndex, personTrailWithCurrentRecord } from "./person-trail";

const t = staffTranslator("en-US");
const base = { locale: "en-US", timezone: "America/New_York", t };
const at = new Date("2026-10-31T13:05:00Z");
// Built with the same formatter the code uses: Intl puts a narrow no-break space before "AM".
const detail = (name: string) => `${formatTime(at, "en-US", "America/New_York")} · ${name}`;

function record(overrides: Partial<RollCallRecord> = {}): RollCallRecord {
  return {
    state: "boarded",
    occurredAt: at,
    recordedByName: "Dana Reyes",
    note: null,
    eventId: "event-a",
    ...overrides,
  };
}

describe("personTrailWithCurrentRecord", () => {
  it("does not repeat the row's current event when the page trail already holds it", () => {
    const trail: PersonTrailEntry[] = [
      {
        label: "Boarded at the dock",
        detail: detail("Dana Reyes"),
        state: "aboard",
        eventId: "event-a",
      },
    ];
    const result = personTrailWithCurrentRecord({
      ...base,
      trail,
      checkpoint: "departure",
      rollCall: record(),
    });
    expect(result).toBe(trail);
  });

  it("adds the current event when the isolated row has no page trail", () => {
    const result = personTrailWithCurrentRecord({
      ...base,
      trail: [],
      checkpoint: "departure",
      rollCall: record({ state: "not_boarded" }),
    });
    expect(result).toEqual([
      {
        label: "Not boarded at the dock",
        detail: detail("Dana Reyes"),
        state: "ashore",
        note: null,
        eventId: "event-a",
      },
    ]);
  });

  it("keeps both lines when two different events format identically", () => {
    // Same minute, same recorder, same (absent) note, different checkpoints:
    // the presentation text collides, the events do not.
    const trail: PersonTrailEntry[] = [
      {
        label: "Back aboard after dive 1",
        detail: detail("Dana Reyes"),
        state: "aboard",
        note: null,
        eventId: "event-earlier",
      },
    ];
    const result = personTrailWithCurrentRecord({
      ...base,
      trail,
      checkpoint: "after_dive_2",
      rollCall: record({ eventId: "event-current" }),
    });
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      label: "Back aboard after dive 2",
      detail: detail("Dana Reyes"),
      state: "aboard",
      eventId: "event-current",
    });
  });

  it("shows a result that has no stored id, even when its text matches a trail line", () => {
    const trail: PersonTrailEntry[] = [
      { label: "Boarded at the dock", detail: detail("Dana Reyes"), state: "aboard", eventId: "x" },
    ];
    const result = personTrailWithCurrentRecord({
      ...base,
      trail,
      checkpoint: "departure",
      rollCall: record({ eventId: undefined }),
    });
    expect(result).toHaveLength(2);
  });

  it("returns the trail untouched for a carried-forward (implied) result", () => {
    const trail: PersonTrailEntry[] = [];
    expect(
      personTrailWithCurrentRecord({
        ...base,
        trail,
        checkpoint: "after_dive_1",
        rollCall: record({ state: "not_boarded", implied: true }),
      }),
    ).toBe(trail);
  });

  it("returns the trail untouched when nothing is recorded", () => {
    const trail: PersonTrailEntry[] = [];
    expect(
      personTrailWithCurrentRecord({
        ...base,
        trail,
        checkpoint: "departure",
        rollCall: undefined,
      }),
    ).toBe(trail);
  });

  it("words the appended line in the requested locale", () => {
    const es = staffTranslator("es-ES");
    const [line] = personTrailWithCurrentRecord({
      locale: "es-ES",
      timezone: "America/New_York",
      t: es,
      trail: [],
      checkpoint: "after_dive_1",
      rollCall: record({ state: "not_boarded", note: "Visto en la superficie" }),
    });
    expect(line).toMatchObject({
      label: es("manifest.personTrailNotBackAfterDive", { dive: 1 }),
      state: "notBack",
      note: "Visto en la superficie",
    });
  });
});

describe("personTrailIndex", () => {
  function manifest(
    checkpoint: TripManifest["checkpoint"],
    divers: Array<{ bookingId: string; rollCall?: RollCallRecord }>,
    crew: Array<{ id: string; rollCall?: RollCallRecord }> = [],
  ) {
    return { checkpoint, divers, crew } as unknown as TripManifest;
  }

  it("lists explicit results per person in checkpoint order with their event ids", () => {
    const index = personTrailIndex(
      [
        manifest("departure", [{ bookingId: "b1", rollCall: record({ eventId: "e1" }) }]),
        manifest("after_dive_1", [
          {
            bookingId: "b1",
            rollCall: record({ state: "not_boarded", eventId: "e2", recordedByName: "Sam" }),
          },
        ]),
      ],
      "en-US",
      "America/New_York",
      t,
    );
    expect(index.get("b1")).toEqual([
      {
        label: "Boarded at the dock",
        detail: detail("Dana Reyes"),
        state: "aboard",
        note: null,
        eventId: "e1",
      },
      {
        label: "Not back after dive 1",
        detail: detail("Sam"),
        state: "notBack",
        note: null,
        eventId: "e2",
      },
    ]);
  });

  it("skips carried-forward results", () => {
    const index = personTrailIndex(
      [
        manifest("after_dive_2", [
          {
            bookingId: "b1",
            rollCall: record({ state: "not_boarded", implied: true, eventId: "e1" }),
          },
        ]),
      ],
      "en-US",
      "America/New_York",
      t,
    );
    expect(index.get("b1")).toBeUndefined();
  });

  it("indexes crew by their own id, alongside divers", () => {
    const index = personTrailIndex(
      [manifest("departure", [], [{ id: "c1", rollCall: record({ eventId: "c-e1" }) }])],
      "en-US",
      "America/New_York",
      t,
    );
    expect(index.get("c1")?.[0]?.eventId).toBe("c-e1");
  });
});
