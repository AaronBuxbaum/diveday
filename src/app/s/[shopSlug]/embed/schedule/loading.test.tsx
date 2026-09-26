// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WeekLedgerSkeleton } from "../../_components/WeekLedgerSkeleton";
import EmbeddedScheduleLoading from "./loading";

afterEach(cleanup);

/**
 * The `<main>` the storefront wears in embed mode, read off the page it stands
 * in for: a server page has no render to inspect without a database, and the
 * frame is the one thing this skeleton exists to get right.
 */
const EMBED_FRAME = /isEmbed\s*\?\s*"([^"]+)"\s*:\s*"mx-auto/.exec(
  readFileSync(join(__dirname, "../../page.tsx"), "utf8"),
)?.[1];

/**
 * **The framed schedule loads in the frame's own shape** (K-371). Under the
 * storefront's segment it streamed in under the shopfront's skeleton — a
 * `max-w-6xl` column 88px from the frame's edge, an identity band and a hero
 * card over the week — and then snapped to a list 12px from the edge with
 * nothing above it.
 */
describe("the framed schedule's skeleton", () => {
  it("is the frame's full-width column, not the storefront's", () => {
    expect(EMBED_FRAME).toBeTruthy();
    const { container } = render(<EmbeddedScheduleLoading />);
    expect(container.querySelector("main")?.getAttribute("class")).toBe(EMBED_FRAME);
    expect(container.innerHTML).not.toContain("max-w-6xl");
  });

  it("is the list and nothing above it, as the frame is", () => {
    const { container } = render(<EmbeddedScheduleLoading />);
    const main = container.querySelector("main");
    expect(main?.children).toHaveLength(1);
    const list = main?.firstElementChild?.outerHTML;
    cleanup();
    const { container: ledger } = render(<WeekLedgerSkeleton />);
    expect(list).toBe(ledger.firstElementChild?.outerHTML);
  });
});
