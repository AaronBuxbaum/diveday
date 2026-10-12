// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "./diver-roll-call-test-fixtures";
import { ManifestMilestones } from "./ManifestMilestones";
import { tripManifest } from "./manifest-page-test-fixtures";

afterEach(cleanup);

describe("ManifestMilestones", () => {
  it("draws nothing on screen before the checkpoint completes", () => {
    const { container } = render(
      <ManifestMilestones
        tripId="trip-1"
        checkpoint="departure"
        summary={tripManifest().summary}
        complete={false}
        t={t}
      />,
    );
    expect(container.textContent).not.toContain(t("shared.subSurfaceRipple.message"));
  });

  it("gives the haptics and the ripple keys of their own, so React keeps both", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ManifestMilestones
          tripId="trip-1"
          checkpoint="departure"
          summary={tripManifest().summary}
          complete={false}
          t={t}
        />,
      );
      const messages = errors.mock.calls.map((call) => String(call[0]));
      expect(messages.filter((message) => message.includes("same key"))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});
