// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ListItemActions } from "./list-item-actions";

describe("ListItemActions", () => {
  it("gives actions a full phone row and an inline desktop row", () => {
    const { container } = render(<ListItemActions>Actions</ListItemActions>);
    expect(container.firstElementChild?.className).toContain("w-full");
    expect(container.firstElementChild?.className).toContain("sm:w-auto");
  });
});
