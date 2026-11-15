// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { IncidentExportDocument } from "@/lib/incident-export";
import { CrewAtDeparture } from "./CrewAtDeparture";

afterEach(cleanup);

it("shows optional decorative crew portraits on screen and omits them when no paths are supplied", () => {
  const doc = {
    meta: { checkpoints: [] },
    crew: [
      { fullName: "Dana Reyes", roles: [], currentRatings: [], buddyTeamNumbers: [], rollCall: [] },
      {
        fullName: "Sal Moretti",
        roles: [],
        currentRatings: [],
        buddyTeamNumbers: [],
        rollCall: [],
      },
    ],
  } as unknown as Pick<IncidentExportDocument, "crew" | "meta">;
  const props = {
    doc,
    t: staffTranslator("en-US"),
    dateTime: (s: string) => s,
    checkpointText: (s: string) => s,
    checkpointClass: "",
  };
  const view = render(
    <CrewAtDeparture {...props} crewPhotos={["/demo-staff/dana-reyes.webp", null]} />,
  );
  expect(screen.getByText("Dana Reyes")).toBeTruthy();
  expect(screen.getByText("Sal Moretti")).toBeTruthy();
  expect(view.container.querySelectorAll("img")).toHaveLength(1);
  expect(view.container.querySelector("img")).toHaveAttribute("alt", "");
  view.rerender(<CrewAtDeparture {...props} />);
  expect(view.container.querySelector("img")).toBeNull();
});
