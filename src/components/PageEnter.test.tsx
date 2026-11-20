// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageEnter } from "./PageEnter";

afterEach(cleanup);

describe("PageEnter", () => {
  it("leaves the first page of a visit at rest, lets every page after it rise in, and adds no element", () => {
    const animate = vi.fn();
    const target = document.createElement("div");
    target.id = "main";
    target.animate = animate;
    document.body.append(target);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;

    const first = render(<PageEnter targetId="main">one</PageEnter>);
    expect(animate).not.toHaveBeenCalled();
    expect(first.container.children).toHaveLength(0);
    first.unmount();
    // A navigation remounts the template: the visit has now shown a page.
    const second = render(<PageEnter targetId="main">two</PageEnter>);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(second.container.children).toHaveLength(0);
  });
});
