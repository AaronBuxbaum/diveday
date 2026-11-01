// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DIVER_LOCALES } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { diver, renderList } from "./diver-roll-call-test-fixtures";

afterEach(cleanup);

/**
 * **A decompression departure says once, above the list, that the crew checks
 * technical cards** (H-20261017-decompression-departure-reminds-crew). An advisory: it names no diver and blocks no one.
 */
describe("the decompression reminder on the roll call", () => {
  const words = (locale: (typeof DIVER_LOCALES)[number]) =>
    staffTranslator(locale)("manifest.decompressionReminder");

  it.each(DIVER_LOCALES)("shows once on a decompression departure with divers (%s)", (locale) => {
    renderList({
      divers: [
        diver({ bookingId: "00000000-0000-4000-8000-000000000001", participantType: "diver" }),
        diver({ bookingId: "00000000-0000-4000-8000-000000000002", participantType: "diver" }),
      ],
      exceedsNoDecoLimits: true,
      checkpoint: "departure",
      locale,
    });
    expect(screen.getAllByText(words(locale))).toHaveLength(1);
  });

  it("is silent on a departure not marked as decompression diving", () => {
    renderList({ divers: [diver({ participantType: "diver" })], exceedsNoDecoLimits: false });
    expect(screen.queryByText(words(DIVER_LOCALES[0]))).toBeNull();
  });

  it("is silent when only a snorkeler and a rider are booked", () => {
    renderList({
      divers: [
        diver({ bookingId: "00000000-0000-4000-8000-000000000001", participantType: "snorkeler" }),
        diver({ bookingId: "00000000-0000-4000-8000-000000000002", participantType: "rider" }),
      ],
      exceedsNoDecoLimits: true,
      checkpoint: "departure",
    });
    expect(screen.queryByText(words(DIVER_LOCALES[0]))).toBeNull();
  });

  it("does not change what a diver's readiness says", () => {
    renderList({
      divers: [diver({ readiness: { status: "blocked", blockers: [] } })],
      exceedsNoDecoLimits: true,
      checkpoint: "departure",
    });
    expect(screen.getAllByText(words(DIVER_LOCALES[0]))).toHaveLength(1);
  });

  it("is silent once the last diver is released", () => {
    renderList({
      divers: [diver({ participantType: "diver", notHere: true })],
      exceedsNoDecoLimits: true,
      checkpoint: "departure",
    });
    expect(screen.queryByText(words(DIVER_LOCALES[0]))).toBeNull();
  });

  it("is silent after a dive, when the plan is behind the crew", () => {
    renderList({
      divers: [diver({ participantType: "diver" })],
      exceedsNoDecoLimits: true,
      checkpoint: "after_dive_1",
    });
    expect(screen.queryByText(words(DIVER_LOCALES[0]))).toBeNull();
  });

  it("is never print-hidden, so the printed packet keeps it", () => {
    renderList({
      divers: [diver({ participantType: "diver" })],
      exceedsNoDecoLimits: true,
      checkpoint: "departure",
    });
    const line = screen.getByText(words(DIVER_LOCALES[0])).closest("p");
    expect(line?.className).not.toMatch(/print:hidden|\bhidden\b/);
  });

  it("shows for a guide in the water when every guest is a snorkeler or rider", () => {
    renderList({
      divers: [diver({ participantType: "snorkeler" })],
      crew: [{ id: "c1", fullName: "Dana", roles: ["divemaster"] }] as never,
      exceedsNoDecoLimits: true,
      checkpoint: "departure",
    });
    expect(screen.getAllByText(words(DIVER_LOCALES[0]))).toHaveLength(1);
  });

  it("stays silent for a captain with only snorkelers aboard", () => {
    renderList({
      divers: [diver({ participantType: "snorkeler" })],
      crew: [{ id: "c1", fullName: "Cal", roles: ["captain"] }] as never,
      exceedsNoDecoLimits: true,
      checkpoint: "departure",
    });
    expect(screen.queryByText(words(DIVER_LOCALES[0]))).toBeNull();
  });
});
