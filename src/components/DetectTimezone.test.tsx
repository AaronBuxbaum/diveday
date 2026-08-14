// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetectTimezone } from "./DetectTimezone";

const DEFAULT = "America/New_York";

/**
 * The picker as the server renders it: a real `<select>` already in the
 * document, because that is what this component enhances. It renders nothing
 * itself and finds the box by id.
 */
function picker(value = DEFAULT) {
  document.body.innerHTML = `
    <select id="shop-timezone" name="timezone">
      <option value="America/New_York">Eastern</option>
      <option value="America/Cancun">Cancún</option>
      <option value="Asia/Bangkok">Bangkok</option>
    </select>
  `;
  const select = document.getElementById("shop-timezone") as HTMLSelectElement;
  select.value = value;
  return select;
}

function deviceZone(timeZone: string | undefined) {
  vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
    resolvedOptions: () => ({ timeZone }),
  } as unknown as Intl.DateTimeFormat);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("DetectTimezone", () => {
  it("preselects the device's own zone in a picker nobody has answered", () => {
    const select = picker();
    deviceZone("America/Cancun");

    render(<DetectTimezone selectId="shop-timezone" detect untouchedValue={DEFAULT} />);

    expect(select.value).toBe("America/Cancun");
  });

  it("leaves a pick made before the page hydrated alone", () => {
    // The regression. A native `<select>` is interactive from the moment it
    // paints, well before React hydrates and the effect runs — so a shop that
    // reaches the picker quickly used to watch its answer be replaced by the
    // device's zone a beat later, with nothing on screen explaining it.
    const select = picker("Asia/Bangkok");
    deviceZone("America/Cancun");

    render(<DetectTimezone selectId="shop-timezone" detect untouchedValue={DEFAULT} />);

    expect(select.value).toBe("Asia/Bangkok");
  });

  it("does nothing when the form already carries an answer", () => {
    // A bounce back to the sign-up form with `?timezone=`, which is what
    // `detect` is derived from. That answer wins outright.
    const select = picker("Asia/Bangkok");
    deviceZone("America/Cancun");

    render(
      <DetectTimezone selectId="shop-timezone" detect={false} untouchedValue="Asia/Bangkok" />,
    );

    expect(select.value).toBe("Asia/Bangkok");
  });

  it("keeps the server's default when the device names a zone the picker doesn't offer", () => {
    const select = picker();
    deviceZone("Antarctica/Troll");

    render(<DetectTimezone selectId="shop-timezone" detect untouchedValue={DEFAULT} />);

    expect(select.value).toBe(DEFAULT);
  });

  it("keeps the server's default when the runtime cannot answer at all", () => {
    const select = picker();
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no ICU data");
    });

    render(<DetectTimezone selectId="shop-timezone" detect untouchedValue={DEFAULT} />);

    expect(select.value).toBe(DEFAULT);
  });

  it("does not reach for a picker that isn't on the page", () => {
    document.body.innerHTML = "";
    deviceZone("America/Cancun");

    expect(() =>
      render(<DetectTimezone selectId="shop-timezone" detect untouchedValue={DEFAULT} />),
    ).not.toThrow();
  });
});
