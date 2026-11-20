// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageEnter } from "./PageEnter";

afterEach(cleanup);

describe("PageEnter", () => {
  it("leaves the first page of a visit at rest and lets every page after it rise in", () => {
    const first = render(<PageEnter>one</PageEnter>);
    expect(first.container.querySelector(".page-enter")).toBeNull();
    first.unmount();
    // A navigation remounts the template: the visit has now shown a page.
    const second = render(<PageEnter>two</PageEnter>);
    expect(second.container.querySelector(".page-enter")).not.toBeNull();
  });
});
