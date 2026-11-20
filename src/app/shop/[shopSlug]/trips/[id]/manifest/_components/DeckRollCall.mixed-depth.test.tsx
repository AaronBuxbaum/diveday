// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DeckRollCall } from "./DeckRollCall";
import { diver, diverContext, renderList } from "./diver-roll-call-test-fixtures";

afterEach(cleanup);

function mixedRoster(held = false) {
  return [
    diver({
      bookingId: "intro",
      fullName: "Intro Student",
      identityWithheld: held,
      trainingDive: { courseTitle: "Intro", instructorAboard: true, intro: true },
    }),
    diver({
      bookingId: "entry",
      fullName: "Entry Student",
      trainingDive: { courseTitle: "Open Water", instructorAboard: true, intro: false },
    }),
  ];
}

function renderDeck(divers = mixedRoster()) {
  const context = diverContext({ divers, checkpoint: "departure", isDeparture: true });
  render(
    DeckRollCall({
      view: {
        manifest: {
          trip: { id: context.tripId },
          summary: {},
          divers,
          crew: [],
          completeness: { complete: false },
        },
        rollCall: {
          divers: context,
          crew: {
            ...context,
            crewRollCallAction: context.rollCallAction,
            crewRollCallButtonCopy: context.rollCallButtonCopy("crew"),
          },
        },
        actions: { rollCall: context.rollCallAction, crewRollCall: context.rollCallAction },
        checkpoint: "departure",
        isDeparture: true,
        reader: { alerted: new Set() },
      } as never,
      checkpoint: "Before departure",
      status: <p>Existing safety notice</p>,
      details: null,
      buddiesEnabled: true,
    }),
  );
  return context;
}

it("shows the complete roster's mixed-training advisory before routine recording, without opening Details", () => {
  const context = renderDeck();
  const warning = screen.getByText(context.t("manifest.mixedTrainingDepthWarning"));
  expect(warning).toBeVisible();
  expect(warning.closest("details")).toBeNull();
  expect(
    warning.compareDocumentPosition(screen.getByRole("button", { name: "Start roll call" })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText("Existing safety notice")).toBeVisible();
  expect(context.rollCallAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
  fireEvent.click(screen.getByRole("button", { name: "Intro Student" }));
  fireEvent.click(screen.getByRole("button", { name: context.t("manifest.deck.exception") }));
  expect(screen.getAllByText(context.t("manifest.mixedTrainingDepthWarning"))).toHaveLength(1);
  expect(warning).toBeVisible();
  expect(context.rollCallAction).not.toHaveBeenCalled();
});

it("does not infer a mixed-training warning from a held identity", () => {
  const context = renderDeck(mixedRoster(true));
  expect(screen.queryByText(context.t("manifest.mixedTrainingDepthWarning"))).toBeNull();
});

it("does not warn when the roster contains only the same training kind", () => {
  const roster = mixedRoster();
  roster[0].trainingDive = { courseTitle: "Open Water", instructorAboard: true, intro: false };
  const context = renderDeck(roster);
  expect(screen.queryByText(context.t("manifest.mixedTrainingDepthWarning"))).toBeNull();
});

it.each([false, true])("retains the full-roster advisory with paper=%s", (paper) => {
  renderList({ divers: mixedRoster(), checkpoint: "departure", paper });
  expect(screen.getByText(/If intro participants dive with other students/)).toBeVisible();
});
