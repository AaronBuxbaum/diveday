// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PublicCoursesLoading from "./loading";

afterEach(cleanup);

/**
 * **The catalog's skeleton is the catalog** (pixel-craft class 11, K-380).
 *
 * It drew the header and then the list, and the page has grown three things
 * between and inside them since: the agency tabs (a 54px segmented track),
 * each group's small-caps label, and a 64px thumbnail on every row. At 1280
 * the list landed about 111px below where the skeleton drew it, every title
 * 80px right of its bar, and every row 9px taller.
 */
describe("the public course catalog's skeleton", () => {
  function parts() {
    const { container } = render(<PublicCoursesLoading />);
    const track = container.querySelector(".rounded-inset.border.p-1");
    const list = container.querySelector(".divide-y.border-y");
    return { container, track, list };
  }

  it("draws the agency tabs' track, one 44px option tall, above the list", () => {
    const { track, list } = parts();
    expect(track).not.toBeNull();
    expect(list).not.toBeNull();
    // A hairline and a `p-1` step each side of a 44px option: 54px.
    const options = Array.from(track?.children ?? []);
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) expect(option.className).toMatch(/\bh-11\b/);
    expect(
      track && list ? track.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING : 0,
    ).toBeTruthy();
  });

  it("labels the group above its rules, as the page's GroupLabel does", () => {
    const { list } = parts();
    const label = list?.previousElementSibling;
    expect(label?.className).toMatch(/\bh-4\b/);
    expect(list?.className).toMatch(/\bmt-2\b/);
  });

  it("gives every row the 64px thumbnail before its words", () => {
    const { list } = parts();
    const rows = Array.from(list?.children ?? []);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.className).toMatch(/\bgap-4\b/);
      expect(row.firstElementChild?.className).toMatch(/\bsize-16\b/);
      expect(row.firstElementChild?.className).toMatch(/\brounded-inset\b/);
    }
  });

  it("draws a row's title on its 28px line and a phone's summary on two", () => {
    const { list } = parts();
    const row = list?.firstElementChild;
    expect(row?.querySelector(".h-7")).not.toBeNull();
    expect(row?.querySelector(".h-5.sm\\:hidden")).not.toBeNull();
  });
});
