// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";
import { CheckpointSwitch } from "./CheckpointSwitch";
import { t } from "./diver-roll-call-test-fixtures";
import { crewMember, tripManifest } from "./manifest-page-test-fixtures";

/** One manifest per checkpoint; `open` names how many each has not accounted for. */
function manifests(
  checkpoints: RollCallCheckpoint[],
  open: Partial<Record<RollCallCheckpoint, number>> = {},
): TripManifest[] {
  return checkpoints.map((checkpoint) =>
    tripManifest({
      checkpoint,
      summary: { ...tripManifest().summary, totalDivers: 8, awaiting: open[checkpoint] ?? 0 },
    }),
  );
}

afterEach(cleanup);

describe("CheckpointSwitch", () => {
  it("links every checkpoint on this departure and marks the open one", () => {
    render(
      <CheckpointSwitch
        manifests={manifests(["departure", "after_dive_1"])}
        checkpoint="after_dive_1"
        shopSlug="blue-mantis"
        tripId="trip-1"
        t={t}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=departure",
      "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_1",
    ]);
    expect(links[1]).toHaveAttribute("aria-current", "true");
  });

  /**
   * Batch 6, item 3: opening a checkpoint while the one before it is still
   * open asks first — a warning with a confirm, never a refusal.
   */
  describe("while the checkpoint before is still open", () => {
    const three = manifests(["departure", "after_dive_1", "after_dive_2"], { after_dive_1: 2 });

    it("catches the tap, says who is unmarked, and offers both ways on", () => {
      render(
        <CheckpointSwitch
          manifests={three}
          checkpoint="after_dive_1"
          shopSlug="blue-mantis"
          tripId="trip-1"
          t={t}
        />,
      );
      const dive2 = screen.getAllByRole("link")[2];
      if (!dive2) throw new Error("expected the dive 2 link");
      const clicked = fireEvent.click(dive2);
      // The navigation was held back, not refused.
      expect(clicked).toBe(false);
      expect(screen.getByRole("alert").textContent).toBe("2 divers not marked after dive 1.");
      expect(screen.getByRole("link", { name: "Open anyway" })).toHaveAttribute(
        "href",
        "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_2",
      );
      // Already on dive 1, "back" just puts the question away.
      fireEvent.click(screen.getByRole("button", { name: "Back to dive 1" }));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("lets a tap on a checkpoint with nothing open before it straight through", () => {
      render(
        <CheckpointSwitch
          manifests={three}
          checkpoint="after_dive_2"
          shopSlug="blue-mantis"
          tripId="trip-1"
          t={t}
        />,
      );
      const dock = screen.getAllByRole("link")[0];
      if (!dock) throw new Error("expected the dock link");
      expect(fireEvent.click(dock)).toBe(true);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("says the same line on the checkpoint it opened, without any script", () => {
      render(
        <CheckpointSwitch
          manifests={three}
          checkpoint="after_dive_2"
          shopSlug="blue-mantis"
          tripId="trip-1"
          t={t}
        />,
      );
      expect(screen.getByText(/2 divers not marked after dive 1\./)).toHaveClass("text-danger");
      expect(screen.getByRole("link", { name: "Back to dive 1" })).toHaveAttribute(
        "href",
        "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_1",
      );
    });

    it("words divers and crew apart (dive-domain review 20261014)", () => {
      const dm = (state?: "boarded") =>
        crewMember({
          rollCall: state
            ? { state, occurredAt: new Date("2026-10-14T12:00:00Z"), recordedByName: "Keiko" }
            : undefined,
        });
      const list = manifests(["departure", "after_dive_1", "after_dive_2"], {
        after_dive_1: 11,
      }).map((manifest) => ({
        ...manifest,
        crew: [dm(manifest.checkpoint === "departure" ? "boarded" : undefined)],
      }));
      render(
        <CheckpointSwitch
          manifests={list}
          checkpoint="after_dive_2"
          shopSlug="blue-mantis"
          tripId="trip-1"
          t={t}
        />,
      );
      expect(screen.getByText(/11 divers and 1 crew not marked after dive 1\./)).toBeInTheDocument();
    });

    it("never stands between an open dock count and the first head count", () => {
      render(
        <CheckpointSwitch
          manifests={manifests(["departure", "after_dive_1"], { departure: 1 })}
          checkpoint="after_dive_1"
          shopSlug="blue-mantis"
          tripId="trip-1"
          t={t}
        />,
      );
      expect(screen.queryByText(/not marked/)).toBeNull();
      expect(screen.queryByRole("link", { name: /Back to/ })).toBeNull();
    });
  });
});
