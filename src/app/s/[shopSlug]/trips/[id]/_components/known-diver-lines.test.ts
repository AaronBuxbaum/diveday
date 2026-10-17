import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { formatShortDate } from "@/lib/format";
import { knownDiverFactLines, knownDiverPanelFor } from "./known-diver-lines";

const t = diverTranslator("en-US");
const where = { locale: "en-US" as const, timeZone: "America/New_York" };
const keptAt = new Date("2026-07-01T15:00:00Z");

describe("knownDiverFactLines", () => {
  it("words each kind of fact, one sentence each, in order", () => {
    const lines = knownDiverFactLines(
      [
        { kind: "waiver", keptAt },
        { kind: "contact", name: "Asha Sharma" },
      ] as never,
      t,
      where,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      t("booking.knownDiver.waiver", {
        date: formatShortDate(keptAt, where.locale, where.timeZone),
      }),
    );
    expect(lines[1]).toBe(t("booking.knownDiver.contact", { name: "Asha Sharma" }));
  });
});

describe("knownDiverPanelFor", () => {
  const input = { handoff: null, blankHref: "/s/blue-mantis/trips/t-1#book", ...where };

  it("is no panel when the handoff named nobody", () => {
    expect(knownDiverPanelFor(null, t, input)).toBeNull();
  });

  it("carries the diver, their facts and the gear they took last time", () => {
    const lastGear = { kinds: ["bcd" as const], nitrox: true };
    const panel = knownDiverPanelFor(
      {
        fullName: "Ana Ruiz",
        email: "ana@example.com",
        phone: null,
        facts: [{ kind: "waiver", keptAt }],
        lastGear,
      } as never,
      t,
      input,
    );
    expect(panel).toMatchObject({
      name: "Ana Ruiz",
      handoff: "",
      blankHref: input.blankHref,
      lead: { fullName: "Ana Ruiz", email: "ana@example.com", phone: null },
      lastGear,
    });
    expect(panel?.lines).toHaveLength(1);
  });
});
