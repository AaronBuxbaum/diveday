import { describe, expect, it } from "vitest";
import { departureSectionForm, departureSectionPatch } from "./departure-detail-sections";

describe("section boundaries", () => {
  it("keeps all fifth-dive plan fields and rejects a sixth dive", () => {
    const form = new FormData();
    for (const field of ["title", "siteId", "travelMinutes", "description"]) {
      form.set(`dive-5-${field}`, `fifth ${field}`);
      form.set(`dive-6-${field}`, `sixth ${field}`);
    }
    const filtered = departureSectionForm("plan", form);
    for (const field of ["title", "siteId", "travelMinutes", "description"]) {
      expect(filtered.get(`dive-5-${field}`)).toBe(`fifth ${field}`);
      expect(filtered.has(`dive-6-${field}`)).toBe(false);
    }
  });

  it("ignores forged timing, money, boat and meeting fields in a plan submission", () => {
    const form = new FormData();
    for (const key of [
      "plannedDives",
      "dive-1-siteId",
      "capacity",
      "priceDollars",
      "date",
      "boatId",
      "meetingPointLabel",
      "title",
    ])
      form.set(key, "forged");
    expect([...departureSectionForm("plan", form).keys()]).toEqual([
      "plannedDives",
      "dive-1-siteId",
    ]);
  });

  it("keeps repeated meeting dates only on Timing", () => {
    const form = new FormData();
    form.append("meetingDate", "2030-08-03");
    form.append("meetingDate", "2030-08-04");
    expect(departureSectionForm("timing", form).getAll("meetingDate")).toEqual([
      "2030-08-03",
      "2030-08-04",
    ]);
    expect([...departureSectionForm("booking", form)]).toEqual([]);
  });

  it("never includes untouched schedule or financial columns in a meeting patch", () => {
    const patch = {
      title: "Stored",
      startsAt: new Date("2030-08-02T13:00:00Z"),
      endsAt: new Date("2030-08-02T17:00:00Z"),
      capacity: 10,
      plannedDives: 2,
      priceCents: null,
      meetingPointLabel: "North dock",
      changeActorPersonId: "actor",
    };
    expect(departureSectionPatch("meeting", patch)).toEqual({
      meetingPointLabel: "North dock",
      changeActorPersonId: "actor",
    });
  });
});
