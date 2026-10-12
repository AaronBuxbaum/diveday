// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineChecklist } from "./Checklist";
import { controls, view } from "./section-fixtures";

afterEach(cleanup);

describe("OfflineChecklist", () => {
  it("draws no checklist for a shop that keeps none", () => {
    const { container } = render(<OfflineChecklist view={view()} controls={controls()} />);
    expect(container.innerHTML).toBe("");
  });
});
