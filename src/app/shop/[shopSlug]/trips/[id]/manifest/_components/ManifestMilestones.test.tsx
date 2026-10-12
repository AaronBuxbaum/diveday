// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
