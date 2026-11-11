// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeBar } from "./chrome/ChromeBar";
import { DemoBanner } from "./DemoBanner";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const COPY = {
  shopLabel: "Demo shop",
  viewingAs: "Viendo como",
  switchRole: "Cambiar rol",
  sharedWarning: "",
  current: "Actual",
  switchAction: "",
  switchFailed: "",
  startTitle: "Start here",
  startCaptain: "Call the roll as the captain",
  startDesk: "Check a diver in at the desk",
  startDiver: "Book a seat as a diver",
  dismissStarts: "Dismiss starting places",
};

const ROLES = [
  {
    id: "owner" as const,
    name: "Dana Reyes",
    title: "Propietaria",
    switchAriaLabel: "",
  },
];

function renderBanner() {
  return render(
    <DemoBanner
      currentRole="owner"
      currentName="Dana Reyes"
      shopSlug="demo"
      roles={ROLES}
      copy={COPY}
      switchRole={async () => {}}
    />,
  );
}

/** The one class in a list that sets a max width, e.g. `max-w-6xl`. */
function maxWidthOf(element: Element | null): string | undefined {
  return [...(element?.classList ?? [])].find((token) => token.startsWith("max-w-"));
}

/**
 * The banner sits directly above the chrome bar on every demo page, so its
 * geometry is read against the bar's (docs/design/pixel-craft.md, classes 3,
 * 6 and 8).
 */
describe("DemoBanner", () => {
  it("keeps the viewer's name whole, with the space before it outside the unit", () => {
    // In Spanish "Viendo como Propietaria (Dana Reyes)" broke inside the
    // parentheses at 390px, leaving "Reyes)" alone on a second line.
    renderBanner();
    const name = screen.getByText("(Dana Reyes)");
    expect(name.textContent).toBe("(Dana Reyes)");
    expect(name).toHaveClass("whitespace-nowrap");
  });

  it("draws the shop label as a Badge pill, with no hand-rolled 6px corner anywhere in the banner", () => {
    const { container } = renderBanner();
    expect(screen.getByText("Demo shop")).toHaveClass("rounded-full");
    expect(container.querySelector(".rounded-md")).toBeNull();
  });

  it("lays its content on the chrome bar's row, not a narrower column", () => {
    // `max-w-4xl` under a `max-w-6xl` bar started the banner's text at x 216
    // at 1280, where the bar's own content and the page start at 88.
    const { container } = renderBanner();
    const bannerRow = container.firstElementChild?.firstElementChild ?? null;
    const { container: bar } = render(<ChromeBar leading={<span>Shop</span>} />);
    const barRow = bar.querySelector("header")?.firstElementChild ?? null;
    expect(maxWidthOf(barRow)).toBeDefined();
    expect(maxWidthOf(bannerRow)).toBe(maxWidthOf(barRow));
  });

  it("opens the picker as a popover of rows, the current role a word and not a button", () => {
    // Visual review 2026-10-24, A41: the band of five role cards pushed every
    // page down; the picker now floats under its button.
    render(
      <DemoBanner
        currentRole="owner"
        currentName="Dana Reyes"
        shopSlug="demo"
        roles={[
          ...ROLES,
          {
            id: "captain",
            name: "Sal Moretti",
            title: "Capitán",
            switchAriaLabel: "Cambiar a Capitán",
          },
        ]}
        copy={{ ...COPY, switchAction: "Cambiar" }}
        switchRole={async () => {}}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Cambiar rol/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const picker = document.getElementById("demo-role-picker");
    expect(picker).toHaveClass("absolute");
    expect(screen.getByText("Actual").tagName).toBe("SPAN");
    expect(screen.queryByRole("button", { name: /Propietaria/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Cambiar a Capitán" })).toHaveTextContent("Cambiar");
    expect(screen.getByText("Sal Moretti")).toBeInTheDocument();
  });

  it("closes on Escape and hands focus back to its button", () => {
    renderBanner();
    const trigger = screen.getByRole("button", { name: /Cambiar rol/ });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.getElementById("demo-role-picker")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.getElementById("demo-role-picker")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  describe("switching role", () => {
    const TWO_ROLES = [
      ...ROLES,
      {
        ...ROLES[0],
        id: "captain" as const,
        title: "Capitán",
        switchAriaLabel: "Switch to captain",
      },
    ];

    function renderSwitcher(switchRole: () => Promise<void>) {
      render(
        <DemoBanner
          currentRole="owner"
          currentName="Dana Reyes"
          shopSlug="demo"
          roles={TWO_ROLES}
          copy={{ ...COPY, switchFailed: "That role switch didn’t go through." }}
          switchRole={switchRole}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Cambiar rol/ }));
      fireEvent.click(screen.getByRole("button", { name: "Switch to captain" }));
    }

    it("says nothing went wrong when the action ends, as every switch does, in a redirect", async () => {
      // The reported bug: every switch worked and still printed the failure,
      // because the redirect's sentinel reached the client's catch.
      const redirectSentinel = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/shop/demo;307;",
      });
      const switchRole = async () => {
        throw redirectSentinel;
      };
      // The rethrown sentinel leaves the transition and React reports it on
      // `window` (in the app, Next's router takes it from there). Wait for it
      // here and claim it: left alone it lands after the test has ended and
      // fails the run as an unhandled error, depending on timing.
      let onError: (event: ErrorEvent) => void = () => {};
      const rethrown = new Promise<unknown>((resolve) => {
        onError = (event) => {
          if (event.error !== redirectSentinel) return;
          event.preventDefault();
          resolve(event.error);
        };
        window.addEventListener("error", onError);
      });
      try {
        renderSwitcher(switchRole);
        await waitFor(() => expect(screen.queryByText(/Capitán/)).toBeNull());
        await expect(rethrown).resolves.toBe(redirectSentinel);
        expect(screen.queryByRole("alert")).toBeNull();
      } finally {
        window.removeEventListener("error", onError);
      }
    });

    it("says the switch failed when the request itself fails", async () => {
      const switchRole = async () => {
        throw new TypeError("Failed to fetch");
      };
      const consoleError = console.error;
      console.error = () => {};
      try {
        renderSwitcher(switchRole);
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "That role switch didn’t go through.",
        );
      } finally {
        console.error = consoleError;
      }
    });
  });
});

describe("first-arrival starting places", () => {
  function starts(shopSlug = "demo-first") {
    const switchRole = vi.fn(async () => {});
    const view = render(
      <DemoBanner
        currentRole="owner"
        shopSlug={shopSlug}
        starts={[
          { id: "captain", role: "captain", label: COPY.startCaptain },
          { id: "desk", role: "owner", label: COPY.startDesk },
          { id: "diver", role: "diver", label: COPY.startDiver },
        ]}
        roles={[
          ...ROLES,
          { id: "captain", name: "Sal", title: "Captain", switchAriaLabel: "Captain" },
          { id: "diver", name: "", title: "Diver", switchAriaLabel: "Diver" },
        ]}
        copy={COPY}
        isMintedDemo
        switchRole={switchRole}
      />,
    );
    return { ...view, switchRole };
  }

  it("offers the feature pages' role and landing, including the current role", async () => {
    const { switchRole } = starts();
    fireEvent.click(screen.getByRole("button", { name: COPY.startDesk }));
    await waitFor(() => expect(switchRole).toHaveBeenCalledWith("owner", "demo-first", "desk"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: COPY.startCaptain })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: COPY.startCaptain }));
    await waitFor(() =>
      expect(switchRole).toHaveBeenCalledWith("captain", "demo-first", "captain"),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: COPY.startDiver })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: COPY.startDiver }));
    await waitFor(() => expect(switchRole).toHaveBeenCalledWith("diver", "demo-first", "diver"));
  });

  it("keeps a dismissal for this demo session without hiding a new demo's choices", () => {
    const first = starts();
    fireEvent.click(screen.getByRole("button", { name: COPY.dismissStarts }));
    expect(screen.queryByRole("button", { name: COPY.startCaptain })).toBeNull();
    first.unmount();
    const again = starts();
    expect(screen.queryByRole("button", { name: COPY.startCaptain })).toBeNull();
    again.unmount();
    starts("another-demo");
    expect(screen.getByRole("button", { name: COPY.startCaptain })).toBeVisible();
  });
});
