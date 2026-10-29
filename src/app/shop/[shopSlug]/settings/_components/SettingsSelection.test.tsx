// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSelection } from "./SettingsSelection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function pressSettingsControl() {
  let active = true;
  const control = document.createElement("a");
  const originalQuerySelector = document.querySelector.bind(document);
  vi.spyOn(document, "querySelector").mockImplementation((selector) =>
    selector === "[data-settings-group] :active" && active
      ? control
      : originalQuerySelector(selector),
  );
  return { release: () => (active = false) };
}

function renderSelection(initialSection: "units" | null = null) {
  return render(
    <SettingsSelection initialSection={initialSection}>
      <div data-settings-group="shop">
        <div data-settings-section="timezone">
          <details>
            <summary>Timezone</summary>
            <p>Timezone form</p>
          </details>
        </div>
        <div data-settings-section="units">
          <details>
            <summary>Units</summary>
            <p>Units form</p>
          </details>
        </div>
        <div data-settings-door>Team door</div>
      </div>
      <div data-settings-group="money">
        <div data-settings-section="stripe">
          <details>
            <summary>Payments</summary>
          </details>
        </div>
        <div data-settings-door>Bookkeeper door</div>
      </div>
      <div data-settings-group="data">
        <section data-settings-urgent>Pending data job</section>
        <div data-settings-door>Data door</div>
      </div>
    </SettingsSelection>,
  );
}

describe("the selected settings pane", () => {
  it("opens the default setting and supplies rules that retain urgent notices", () => {
    const { container } = renderSelection();
    expect(container.firstElementChild).toHaveAttribute("data-settings-selection", "timezone");
    expect(screen.getByText("Timezone form").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Timezone")).toBeVisible();
    expect(screen.getByText("Units")).not.toBeVisible();
    expect(screen.getByText("Team door")).not.toBeVisible();
    expect(screen.getByText("Pending data job")).toBeVisible();
  });

  it("opens a hash target and follows later fragment changes", () => {
    window.history.replaceState(null, "", "/#units");
    const { container } = renderSelection();
    expect(container.firstElementChild).toHaveAttribute("data-settings-selection", "units");
    expect(screen.getByText("Units form").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Units")).toBeVisible();
    expect(screen.getByText("Timezone")).not.toBeVisible();
    act(() => {
      window.location.hash = "timezone";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(container.firstElementChild).toHaveAttribute("data-settings-selection", "timezone");
  });

  it.each(["money", "data"])("preserves an existing %s group fragment", (group) => {
    window.history.replaceState(null, "", `/#${group}`);
    const { container } = renderSelection();
    expect(container.firstElementChild).toHaveAttribute(
      "data-settings-selection",
      `group:${group}`,
    );
    const door = group === "money" ? "Bookkeeper door" : "Data door";
    expect(screen.getByText(door)).toBeVisible();
    expect(screen.getByText("Timezone")).not.toBeVisible();
  });

  it("leaves all settings available in server markup without JavaScript", () => {
    const html = renderToStaticMarkup(
      <SettingsSelection initialSection={null}>
        <div data-settings-group="shop">
          <div data-settings-section="timezone">Timezone</div>
          <div data-settings-section="units">Units</div>
          <div data-settings-door>Team</div>
        </div>
      </SettingsSelection>,
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    expect(container.firstElementChild).not.toHaveAttribute("data-settings-selection");
    expect(screen.getByText("Timezone")).toBeVisible();
    expect(screen.getByText("Units")).toBeVisible();
    expect(screen.getByText("Team")).toBeVisible();
    container.remove();
  });

  it("opens the section returned by a save when there is no fragment", () => {
    const { container } = renderSelection("units");
    expect(container.firstElementChild).toHaveAttribute("data-settings-selection", "units");
    expect(screen.getByText("Units form").closest("details")).toHaveAttribute("open");
  });

  it("applies the latest fragment after a pressed control is released", () => {
    window.history.replaceState(null, "", "/#units");
    const pressedControl = pressSettingsControl();
    const { container } = renderSelection();
    const selection = container.firstElementChild;
    expect(selection).toHaveAttribute("data-selection-pending", "true");

    act(() => {
      window.history.replaceState(null, "", "/#timezone");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(selection).not.toHaveAttribute("data-settings-selection");

    let applyFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      applyFrame = callback;
      return 1;
    });
    act(() => {
      pressedControl.release();
      document.dispatchEvent(new Event("pointerup"));
      applyFrame?.(0);
    });
    expect(selection).toHaveAttribute("data-settings-selection", "timezone");
    expect(selection).not.toHaveAttribute("data-selection-pending");
  });

  it("cancels a queued release update when a newer fragment arrives", () => {
    window.history.replaceState(null, "", "/#units");
    const pressedControl = pressSettingsControl();
    const { container } = renderSelection();
    const selection = container.firstElementChild;
    let applyFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      applyFrame = callback;
      return 1;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");

    act(() => {
      pressedControl.release();
      document.dispatchEvent(new Event("pointerup"));
    });
    expect(applyFrame).toBeDefined();

    act(() => {
      window.history.replaceState(null, "", "/#timezone");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(selection).toHaveAttribute("data-settings-selection", "timezone");

    act(() => applyFrame?.(0));
    expect(selection).toHaveAttribute("data-settings-selection", "timezone");
  });

  it("cancels release handling when unmounted during a press", () => {
    window.history.replaceState(null, "", "/#units");
    const pressedControl = pressSettingsControl();
    const { unmount } = renderSelection();
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");
    unmount();

    act(() => {
      pressedControl.release();
      document.dispatchEvent(new Event("pointerup"));
    });
    expect(requestFrame).not.toHaveBeenCalled();
  });
});
