// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "./diver-roll-call-test-fixtures";
import { ManifestDeviceSettings } from "./ManifestDeviceSettings";

vi.mock("../actions", () => {
  const action = { bind: () => vi.fn() };
  return {
    subscribePushAction: action,
    unsubscribePushAction: action,
    isPushSubscribedAction: action,
    isPushSubscribedAnywhereAction: vi.fn(),
  };
});

afterEach(cleanup);

describe("ManifestDeviceSettings", () => {
  it("renders the device group's grid without a stray inset", () => {
    const { container } = render(<ManifestDeviceSettings tripId="trip-1" t={t} />);
    expect(container.firstElementChild?.className).toContain("grid gap-5");
  });
});
