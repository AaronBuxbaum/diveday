// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorToast } from "@/components/Toast";
import { staffTranslator } from "@/i18n/staff-messages";
import { BoatPaperFields } from "./BoatPaperFields";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(["certificate", "radio", "channel"] as const)(
  "retains the %s invalid marker when no field wording is supplied",
  (kind) => {
    const t = staffTranslator("en-US");
    render(
      <BoatPaperFields
        t={t}
        invalid={kind === "certificate"}
        radioInvalid={kind === "radio"}
        channelInvalid={kind === "channel"}
      />,
    );
    const control = screen.getByLabelText(
      t(
        kind === "certificate"
          ? "boats.certifiedPassengersLabel"
          : kind === "radio"
            ? "boats.callSignLabel"
            : "boats.workingChannelLabel",
      ),
    );
    expect(control).toHaveAttribute("aria-invalid", "true");
  },
);

it.each(["certificate", "radio", "channel"] as const)(
  "keeps %s field errors associated after the outcome toast expires",
  async (kind) => {
    vi.useFakeTimers();
    const t = staffTranslator("en-US");
    const error = "Correct this boat's details.";
    render(
      <>
        <BoatPaperFields
          t={t}
          error={error}
          invalid={kind === "certificate"}
          radioInvalid={kind === "radio"}
          channelInvalid={kind === "channel"}
        />
        <ErrorToast message={error} />
      </>,
    );
    const control = screen.getByLabelText(
      t(
        kind === "certificate"
          ? "boats.certifiedPassengersLabel"
          : kind === "radio"
            ? "boats.callSignLabel"
            : "boats.workingChannelLabel",
      ),
    );
    expect(control).toHaveAccessibleDescription(expect.stringContaining(error));
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription(expect.stringContaining(error));
    for (const id of control.getAttribute("aria-describedby")?.split(/\s+/) ?? [])
      expect(document.getElementById(id)).not.toBeNull();
  },
);
