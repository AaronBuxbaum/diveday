// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "./diver-roll-call-test-fixtures";
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
        t={t}
      />,
    );
    const line = container.querySelector("p") as HTMLElement;
    expect(line.className).toContain("hidden");
    expect(line.className).toContain("print:block");
    expect(line).toHaveTextContent(t("manifest.soulsOnBoardCrewToConfirm", { count: 1 }));
  });

  it("says nothing more when no crew member is claimed twice", () => {
    render(<PrintedSoulsOnBoard manifest={tripManifest({ crew: [crewMember()] })} t={t} />);
    expect(
      screen.queryByText(t("manifest.soulsOnBoardCrewToConfirm", { count: 1 }), { exact: false }),
    ).toBeNull();
  });
});
