// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { ElearningQuery } from "@/lib/elearning-check";
import { ElearningCheck } from "./ElearningCheck";
import { elearningCheckCopy } from "./elearning-check-copy";

/**
 * "Check eLearning with PADI" beside a course student's materials tick
 * (H-106): there only when the extension is, and only while there is
 * something to tick.
 */

vi.mock("@/components/useCertCheckExtension", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/useCertCheckExtension")>()),
  requestElearningPage: vi.fn(),
}));
const { requestElearningPage } = await import("@/components/useCertCheckExtension");

const query: ElearningQuery = {
  agency: "padi",
  firstName: "Lena",
  lastName: "Ortiz",
  email: "lena.ortiz@example.com",
  courseTitle: "PADI Open Water Diver",
};
const copy = elearningCheckCopy(staffTranslator("en-US"));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-diveday-cert-check");
});

function renderCheck(props: Partial<Parameters<typeof ElearningCheck>[0]> = {}) {
  const action = vi.fn(async () => ({ ok: true, verdict: "no_record" }) as const);
  render(
    <ElearningCheck
      query={query}
      bookingId="b-1"
      materialsDone={false}
      action={action}
      copy={copy}
      {...props}
    />,
  );
  return action;
}

describe("ElearningCheck", () => {
  it("draws nothing without the extension", () => {
    renderCheck();
    expect(screen.queryByRole("button", { name: "Check eLearning with PADI" })).toBeNull();
  });

  it("offers the check when the extension is here and the materials are not done", () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.1.0");
    renderCheck();
    expect(screen.getByRole("button", { name: "Check eLearning with PADI" })).toBeInTheDocument();
  });

  it("offers nothing once the materials are done, or for a seat it cannot search", () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.1.0");
    renderCheck({ materialsDone: true });
    renderCheck({ query: null });
    expect(screen.queryByRole("button", { name: "Check eLearning with PADI" })).toBeNull();
  });

  it("asks the extension, then hands the page it read to the server", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.1.0");
    vi.mocked(requestElearningPage).mockResolvedValue({ ok: true, pageText: "No results found" });
    const action = renderCheck();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check eLearning with PADI" }));
    });
    expect(requestElearningPage).toHaveBeenCalledWith(query);
    expect(await screen.findByText(copy.noRecord)).toBeInTheDocument();
    const formData = (action.mock.calls[0] as unknown[] | undefined)?.[1] as FormData;
    expect(formData.get("bookingId")).toBe("b-1");
    expect(formData.get("pageText")).toBe("No results found");
  });

  it("says it could not read PADI when the extension comes back empty-handed", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.1.0");
    vi.mocked(requestElearningPage).mockResolvedValue({ ok: false, reason: "fill_failed" });
    const action = renderCheck();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check eLearning with PADI" }));
    });
    expect(await screen.findByText(copy.unreadable)).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });
});
