// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectivityStatus } from "./ConnectivityStatus";

afterEach(cleanup);

const copy = {
  online: "Online",
  onlineTitle: "This device is online.",
  offlineTitle: "This device has no connection right now.",
};

/**
 * `navigator.onLine` is read in an effect, so it has to be set before render.
 * jsdom does not define it as a configurable accessor, so this defines one
 * rather than spying on a property that is not there.
 */
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

describe("ConnectivityStatus", () => {
  it("says which state it is in, by default", () => {
    setOnline(true);
    render(<ConnectivityStatus offlineLabel="No signal" copy={copy} />);
    expect(screen.getByRole("status")).toHaveTextContent("Online");
  });

  it("uses the surface's own words for offline", () => {
    setOnline(false);
    render(
      <ConnectivityStatus offlineLabel="Offline — this board may be out of date" copy={copy} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Offline — this board may be out of date");
  });

  /**
   * **A live-only board does not need telling it is fine.**
   *
   * On the offline manifest, connectivity *is* the subject — the card around
   * this pill is about the device copy, and "Online" answers the question the
   * card raises. On Today and the counter queue it is not: a permanently green
   * badge under the page title says nothing a reader could get wrong without
   * it, on the two screens a shop looks at most. What earns its room there is
   * the warning (issue #819).
   */
  it("renders nothing at all while online, when the surface asked it not to", () => {
    setOnline(true);
    const { container } = render(
      <ConnectivityStatus offlineLabel="Offline" onlyWhenOffline copy={copy} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("still warns when the connection goes, with the same flag set", () => {
    setOnline(false);
    render(<ConnectivityStatus offlineLabel="Offline" onlyWhenOffline copy={copy} />);
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
  });

  it("keeps the glyph out of the announced text", () => {
    // `●`/`×` are the colourblind-safe cue beside the word, not the word — a
    // screen reader that reads them aloud is reading punctuation at someone.
    setOnline(false);
    render(<ConnectivityStatus offlineLabel="Offline" copy={copy} />);
    expect(screen.getByRole("status").querySelector("[aria-hidden='true']")).toHaveTextContent("×");
  });
});
