// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RememberShelf } from "./RememberShelf";

describe("RememberShelf", () => {
  it("remembers the phone once, even when the route re-renders with a fresh action", () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    // The bound server action is a new reference on every server render, and
    // the action's own cookie write triggers one — so the prop changes right
    // after the first call.
    const view = render(<RememberShelf remember={first} />);
    view.rerender(<RememberShelf remember={second} />);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    const view = render(<RememberShelf remember={async () => {}} />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
