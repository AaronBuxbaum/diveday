// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildTripManifest } from "@/lib/manifests";
import { diver, t } from "./diver-roll-call-test-fixtures";
import { crewMember, tripManifest } from "./manifest-page-test-fixtures";
import { PrintedSoulsOnBoard } from "./PrintedSoulsOnBoard";

afterEach(cleanup);

describe("PrintedSoulsOnBoard", () => {
  it("prints on paper only, and qualifies the count when another boat claims a crew member", () => {
    const { container } = render(
      <PrintedSoulsOnBoard
        manifest={tripManifest({
          crew: [crewMember({ clashes: [{ tripId: "other" }] as never })],
        })}
        vesselName={null}
        t={t}
      />,
    );
    const line = container.querySelector("p") as HTMLElement;
    expect(line.className).toContain("hidden");
    expect(line.className).toContain("print:block");
    expect(line).toHaveTextContent(t("manifest.soulsOnBoardCrewToConfirm", { count: 1 }));
  });

  it("says nothing more when no crew member is claimed twice", () => {
    render(
      <PrintedSoulsOnBoard
        manifest={tripManifest({ crew: [crewMember()] })}
        vesselName={null}
        t={t}
      />,
    );
    expect(
      screen.queryByText(t("manifest.soulsOnBoardCrewToConfirm", { count: 1 }), { exact: false }),
    ).toBeNull();
  });
});

/**
 * **The figure read over the radio counts everyone aboard** (#2508): divers,
 * snorkelers and riders are all passengers, and the crew add to them. One of
 * each passenger and two crew is five souls, and nothing else pins that.
 */
describe("the printed souls-on-board figure", () => {
  it("counts every passenger, whatever they came to do, plus the crew", () => {
    const manifest = buildTripManifest({
      trip: tripManifest().trip,
      crew: [
        crewMember(),
        crewMember({ id: "00000000-0000-4000-8000-0000000000c2", fullName: "Tom Reyes" }),
      ],
      divers: [
        diver({ bookingId: "00000000-0000-4000-8000-000000000001", participantType: "diver" }),
        diver({ bookingId: "00000000-0000-4000-8000-000000000002", participantType: "snorkeler" }),
        diver({ bookingId: "00000000-0000-4000-8000-000000000003", participantType: "rider" }),
      ] as never,
    });
    const { container } = render(
      <PrintedSoulsOnBoard manifest={manifest} vesselName={null} t={t} />,
    );
    const line = container.querySelector("p") as HTMLElement;
    expect(line.textContent).toMatch(/Passengers 3 \(.*\) · Crew 2 · Souls on board 5$/);
  });

  it("names the boat the departure sails on first (fourth review, item 11)", () => {
    const { container } = render(
      <PrintedSoulsOnBoard manifest={tripManifest()} vesselName="Mantis I" t={t} />,
    );
    expect((container.querySelector("p") as HTMLElement).textContent).toMatch(/^Mantis I · /);
  });
});
