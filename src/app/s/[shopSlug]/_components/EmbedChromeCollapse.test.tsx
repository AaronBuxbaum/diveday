// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import EmbeddedScheduleLoading from "../embed/schedule/loading";
import EmbeddedTripLoading from "../trips/[id]/embed/loading";
import { CHROME_PLACEHOLDER_ATTRIBUTE, EmbedChromeCollapse } from "./EmbedChromeCollapse";

afterEach(cleanup);

const source = (file: string) => readFileSync(join(__dirname, file), "utf8");

/**
 * The layout's chrome bar as it stands in the static shell, beside a framed
 * segment's own render: the rule has to reach across from one to the other.
 * The real bar lives in `PublicShopShell.tsx`, whose readers open the database
 * at import, so its marker is read off the source below instead.
 */
function barBeside(segment: ReactElement): HTMLElement {
  const { container } = render(
    <>
      <div {...{ [CHROME_PLACEHOLDER_ATTRIBUTE]: "" }} data-testid="bar" />
      {segment}
    </>,
  );
  const bar = container.querySelector<HTMLElement>('[data-testid="bar"]');
  if (!bar) throw new Error("the bar did not render");
  return bar;
}

/**
 * **A frame's static shell draws no chrome bar** (K-382). The layout holds
 * the header band's height above every public page, and a frame's real chrome
 * is nothing, so inside a frame that bar painted 57px above the skeleton and
 * then vanished, taking the whole frame up with it.
 */
describe("the framed segments' chrome collapse", () => {
  it("hides the bar it names, and nothing hides it without it", () => {
    expect(getComputedStyle(barBeside(<EmbedChromeCollapse />)).display).toBe("none");
    cleanup();
    expect(getComputedStyle(barBeside(<p>page</p>)).display).not.toBe("none");
  });

  it("names the bar the layout actually draws", () => {
    const placeholder = /export function PublicShopChromePlaceholder[\s\S]*?\n}\n/.exec(
      source("PublicShopShell.tsx"),
    )?.[0];
    expect(placeholder).toBeTruthy();
    expect(placeholder).toMatch(
      new RegExp(`className="h-\\(--chrome-h\\)[^"]*"[^>]*\\s${CHROME_PLACEHOLDER_ATTRIBUTE}\\b`),
    );
  });

  it("is carried by both framed skeletons, from the static shell on", () => {
    for (const [name, skeleton] of [
      ["schedule", <EmbeddedScheduleLoading key="schedule" />],
      ["trip", <EmbeddedTripLoading key="trip" />],
    ] as const) {
      expect(getComputedStyle(barBeside(skeleton)).display, name).toBe("none");
      cleanup();
    }
  });

  it("is carried by both framed pages, so the bar cannot come back between the skeleton and the chrome", () => {
    // The page body can land before the chrome does; when it replaces the
    // skeleton, the skeleton's rule goes with it.
    for (const file of ["../embed/schedule/page.tsx", "../trips/[id]/embed/page.tsx"]) {
      expect(source(file), file).toMatch(/<EmbedChromeCollapse \/>/);
    }
  });
});
