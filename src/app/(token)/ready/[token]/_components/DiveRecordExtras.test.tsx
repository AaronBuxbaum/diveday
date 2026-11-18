// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { SAMPLE_PROFILE } from "@/lib/dive-profile-sample";
import { props } from "./after-state-test-fixtures";
import { AFTER_STATE_TEST_IDS } from "./after-state-test-ids";
import { RecordComputerDives, RecordPhotoStrip } from "./DiveRecordExtras";

afterEach(cleanup);

const photo = (id: string) => ({ id, imageUrl: `https://img.test/${id}.jpg`, caption: null });

describe("RecordPhotoStrip", () => {
  it("draws nothing without photos", () => {
    const { container } = render(<RecordPhotoStrip {...props()} tripTitle="T" photos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the first three and leaves the rest to the photos row", () => {
    render(
      <RecordPhotoStrip {...props()} tripTitle="T" photos={["a", "b", "c", "d"].map(photo)} />,
    );
    expect(
      screen.getByTestId(AFTER_STATE_TEST_IDS.photoStrip).querySelectorAll("img"),
    ).toHaveLength(3);
  });
});

describe("RecordComputerDives", () => {
  const samples = SAMPLE_PROFILE.map((s) => ({ seconds: s.seconds, meters: s.meters }));
  const context = props();

  it.each(["en-US", "es-ES"])("makes the lack of departure linkage clear in %s", (locale) => {
    const t = diverTranslator(locale);
    render(
      <RecordComputerDives
        {...context}
        t={t}
        computerDives={[
          {
            recordedAt: "2026-01-01 · 08:00",
            device: null,
            maxMeters: null,
            averageMeters: null,
            durationSeconds: null,
            coldestC: null,
            samples: [],
          },
        ]}
      />,
    );
    expect(screen.getByRole("region", { name: t("recap.profile.heading") })).toBeTruthy();
    expect(screen.getByText(t("recap.profile.unlinked"))).toBeTruthy();
    expect(screen.getByText("2026-01-01 · 08:00")).toBeTruthy();
  });

  it("draws nothing when no computer logged the day", () => {
    const { container } = render(<RecordComputerDives {...context} computerDives={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the chart and facts from the recording", () => {
    const { container } = render(
      <RecordComputerDives
        {...context}
        computerDives={[
          {
            recordedAt: "Jan 1, 2026 · 11:50 PM · time zone unknown",
            device: "Shearwater Perdix",
            maxMeters: 18.2,
            averageMeters: 13,
            durationSeconds: 42 * 60,
            coldestC: 26,
            samples,
          },
        ]}
      />,
    );
    expect(screen.getByText("Shearwater Perdix")).toBeTruthy();
    expect(screen.getByText("recap.profile.minutesValue(42)")).toBeTruthy();
    expect(container.querySelector("svg path")).not.toBeNull();
    expect(screen.getByText("recap.profile.unlinked")).toBeTruthy();
  });

  it("shows the recording timestamp with its unknown zone", () => {
    render(
      <RecordComputerDives
        {...context}
        computerDives={[
          {
            recordedAt: "Jan 1, 2026 · 11:50 PM · time zone unknown",
            device: null,
            maxMeters: 18,
            averageMeters: 12,
            durationSeconds: 40 * 60,
            coldestC: null,
            samples,
          },
        ]}
      />,
    );
    expect(screen.getByText("Jan 1, 2026 · 11:50 PM · time zone unknown")).toBeTruthy();
    expect(screen.getByText("recap.profile.unlinked")).toBeTruthy();
    expect(screen.queryByText("recap.profile.headingCrew")).toBeNull();
  });

  it("shows facts alone, never a made-up chart, when the file had no profile", () => {
    const { container } = render(
      <RecordComputerDives
        {...context}
        computerDives={[
          {
            recordedAt: "Jan 1, 2026 · 11:50 PM · time zone unknown",
            device: null,
            maxMeters: 21,
            averageMeters: null,
            durationSeconds: 38 * 60,
            coldestC: null,
            samples: [],
          },
        ]}
      />,
    );
    expect(screen.getByText("recap.profile.minutesValue(38)")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
});
