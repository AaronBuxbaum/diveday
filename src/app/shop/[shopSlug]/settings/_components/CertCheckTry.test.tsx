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
  viewReport: "View report",
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
  noAccess: "Not allowed on PADI’s site",
  allowSite:
    "Chrome keeps the extension off {agency}’s site. Turn it on in Extensions, DiveDay certification check, Details, Site access.",
  failedNext: "Send us the report below.",
  padiOff:
    "PADI checks are off for this shop. An owner or manager can turn them on in Settings, Features.",
  reportHint: "Copy it, then paste it into an email to us.",
  email: "Email support@dive.day",
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
    render(<CertCheckTry agencies={AGENCIES} copy={COPY} padiOn supportEmail="support@dive.day" />);
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
        ? { ok: true, filled: true, typed: true, submitted: true, hostAccess: true, missing: [] }
        : {
            ok: true,
            filled: false,
            typed: false,
            submitted: false,
            hostAccess: true,
            missing: ["birthDate"],
          },
    );
    vi.mocked(requestPadiSession).mockResolvedValue("signed_in");
    render(<CertCheckTry agencies={AGENCIES} copy={COPY} padiOn supportEmail="support@dive.day" />);
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

    const raw = screen.getByText(/"report": "diveday-cert-check-try"/);
    expect(raw).not.toBeVisible();
    const writeText = vi.fn(async (_value: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: COPY.copy })));
    expect(writeText).toHaveBeenCalledWith(raw.textContent);
    const runsBeforeDisclosure = vi.mocked(requestDryRun).mock.calls.length;
    fireEvent.click(screen.getByText(COPY.viewReport));
    expect(raw).toBeVisible();
    expect(vi.mocked(requestDryRun).mock.calls).toHaveLength(runsBeforeDisclosure);
    const report = JSON.parse(raw.textContent ?? "");
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
        ssi: { result: "passed", hostAccess: true },
        naui: { result: "failed", missing: ["birthDate"] },
        gue: { result: "not_listed" },
      },
    });
  });

  /** Domain review R7 (adversarial), nit: no extension answering, no dry runs sent. */
  it("sends no dry run when the extension does not answer", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    vi.mocked(requestExtensionHello).mockResolvedValue(null);
    vi.mocked(requestDryRun).mockClear();
    vi.mocked(requestPadiSession).mockClear();
    render(<CertCheckTry agencies={AGENCIES} copy={COPY} padiOn supportEmail="support@dive.day" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run the checks" }));
    });
    expect(requestDryRun).not.toHaveBeenCalled();
    expect(requestPadiSession).not.toHaveBeenCalled();
    const samples = screen.getByRole("list", { name: "Sample lookups" });
    for (const item of samples.querySelectorAll("li")) expect(item).toHaveTextContent("No answer");
  });

  /** Domain review R7 (adversarial) 5 and (operational) 3. */
  it("fails a sample whose agency's site Chrome keeps the extension off, and says what to do next", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    vi.mocked(requestExtensionHello).mockResolvedValue({
      version: "1.5.0",
      agencies: ["ssi", "naui", "gue"],
      elearning: ["padi"],
    });
    vi.mocked(requestDryRun).mockImplementation(async (agency) => ({
      ok: true,
      filled: agency !== "gue",
      typed: agency !== "gue",
      submitted: agency !== "gue",
      hostAccess: agency !== "naui",
      missing: agency === "gue" ? ["number"] : [],
    }));
    vi.mocked(requestPadiSession).mockResolvedValue("no_access");
    render(<CertCheckTry agencies={AGENCIES} copy={COPY} padiOn supportEmail="support@dive.day" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run the checks" }));
    });
    const items = screen.getByRole("list", { name: "Sample lookups" }).querySelectorAll("li");
    expect(items[0]).toHaveTextContent("SSIPassed");
    expect(items[1]).toHaveTextContent(
      "NAUIFailedChrome keeps the extension off NAUI’s site. Turn it on in Extensions, DiveDay certification check, Details, Site access.",
    );
    expect(items[2]).toHaveTextContent("GUEFailedSend us the report below.");
    expect(screen.getByText("Not allowed on PADI’s site")).toBeVisible();
    expect(
      screen.getByText(
        "Chrome keeps the extension off PADI’s site. Turn it on in Extensions, DiveDay certification check, Details, Site access.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Copy it, then paste it into an email to us.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Email support@dive.day" })).toHaveAttribute(
      "href",
      "mailto:support@dive.day",
    );
    const raw = screen.getByText(/"report": "diveday-cert-check-try"/);
    expect(raw).not.toBeVisible();
    const writeText = vi.fn(async (_value: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: COPY.copy })));
    expect(writeText).toHaveBeenCalledWith(raw.textContent);
    const runsBeforeDisclosure = vi.mocked(requestDryRun).mock.calls.length;
    fireEvent.click(screen.getByText(COPY.viewReport));
    expect(raw).toBeVisible();
    expect(vi.mocked(requestDryRun).mock.calls).toHaveLength(runsBeforeDisclosure);
    const report = JSON.parse(raw.textContent ?? "");
    expect(report).toMatchObject({
      padi: "no_access",
      samples: { naui: { result: "failed", hostAccess: false }, ssi: { hostAccess: true } },
    });
  });

  /** Domain review R7 (operational), nit: step 3 says when the shop's PADI switch is off. */
  it("says the shop's PADI checks are off beside the PADI step", () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    render(
      <CertCheckTry
        agencies={AGENCIES}
        copy={COPY}
        padiOn={false}
        supportEmail="support@dive.day"
      />,
    );
    expect(screen.getByText(COPY.padiOff)).toBeVisible();
  });
});
