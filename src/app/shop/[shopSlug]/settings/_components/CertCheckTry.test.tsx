// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CertCheckTry, type CertCheckTryCopy } from "./CertCheckTry";

vi.mock("@/components/useCertCheckExtension", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/useCertCheckExtension")>()),
  requestExtensionHello: vi.fn(),
  requestDryRun: vi.fn(),
  requestPadiSession: vi.fn(),
}));
const { requestExtensionHello, requestDryRun, requestPadiSession } = await import(
  "@/components/useCertCheckExtension"
);

/**
 * "Try the checks": each step's outcome from the extension's own answers, and
 * a report that carries versions, outcomes and form words, never a person.
 */
const COPY: CertCheckTryCopy = {
  run: "Run the checks",
  running: "Running…",
  extension: "Extension",
  samples: "Sample lookups",
  padi: "PADI Pros’ Site",
  report: "Session report",
  added: "Added to this browser ({version})",
  notAdded: "Not added",
  outdated: "Update the extension: this browser has {version}, DiveDay needs {minimum}.",
  passed: "Passed",
  failed: "Failed",
  notListed: "Not in this copy",
  signedIn: "Signed in",
  signedOut: "Signed out",
  noTab: "No PADI tab open",
  noAnswer: "No answer",
  copy: "Copy report",
  copied: "Copied",
  copyFailed: "Try again",
};
const AGENCIES = [
  { key: "ssi", name: "SSI" },
  { key: "naui", name: "NAUI" },
  { key: "gue", name: "GUE" },
];

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-diveday-cert-check");
});

describe("CertCheckTry", () => {
  it("runs nothing on a copy older than DiveDay needs, and says to update it", () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.2.0");
    render(<CertCheckTry agencies={AGENCIES} copy={COPY} />);
    expect(
      screen.getByText("Update the extension: this browser has 1.2.0, DiveDay needs 1.5.0."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Run the checks" })).toBeDisabled();
  });

  it("says how each sample lookup and the PADI tab went, and reports no person", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    vi.mocked(requestExtensionHello).mockResolvedValue({
      version: "1.5.0",
      agencies: ["ssi", "naui"],
      elearning: ["padi"],
    });
    vi.mocked(requestDryRun).mockImplementation(async (agency) =>
      agency === "ssi"
        ? { ok: true, filled: true, typed: true, submitted: true, missing: [] }
        : { ok: true, filled: false, typed: false, submitted: false, missing: ["birthDate"] },
    );
    vi.mocked(requestPadiSession).mockResolvedValue("signed_in");
    render(<CertCheckTry agencies={AGENCIES} copy={COPY} />);
    expect(screen.getByText("Added to this browser (1.5.0)")).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run the checks" }));
    });

    const samples = screen.getByRole("list", { name: "Sample lookups" });
    expect(samples.querySelectorAll("li")[0]).toHaveTextContent("SSIPassed");
    expect(samples.querySelectorAll("li")[1]).toHaveTextContent("NAUIFailed");
    expect(samples.querySelectorAll("li")[2]).toHaveTextContent("GUENot in this copy");
    // GUE is not in this copy's list, so it was never sent.
    expect(vi.mocked(requestDryRun).mock.calls.map(([agency]) => agency)).toEqual(["ssi", "naui"]);
    expect(screen.getByText("Signed in")).toBeVisible();

    const report = JSON.parse(
      screen.getByText(/"report": "diveday-cert-check-try"/).textContent ?? "",
    );
    expect(Object.keys(report)).toEqual([
      "report",
      "at",
      "extension",
      "minimum",
      "agencies",
      "elearning",
      "samples",
      "padi",
      "browser",
    ]);
    expect(report).toMatchObject({
      extension: "1.5.0",
      minimum: "1.5.0",
      padi: "signed_in",
      samples: {
        ssi: { result: "passed" },
        naui: { result: "failed", missing: ["birthDate"] },
        gue: { result: "not_listed" },
      },
    });
  });
});
