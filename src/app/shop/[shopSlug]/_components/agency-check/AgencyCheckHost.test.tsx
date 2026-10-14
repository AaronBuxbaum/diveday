// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgencyCheckResult } from "@/app/shop/[shopSlug]/divers/[personId]/card-actions";
import { staffTranslator } from "@/i18n/staff-messages";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import { AgencyCheckAll } from "./AgencyCheckAll";
import { AgencyCheckHost } from "./AgencyCheckHost";
import { AgencyCheckRow } from "./AgencyCheckRow";
import { agencyCheckAllCopy, agencyCheckCopies } from "./agency-check-copy";

/**
 * **The agency check on a departure's Divers tab** (H-105): each row's own
 * button, and the departure's "Check all", one card at a time, skipping one
 * page it cannot read and stopping on two in a row, with a Stop, Undo on each
 * card and none for the boat.
 */

vi.mock("@/components/useCertCheckExtension", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/useCertCheckExtension")>()),
  requestAgencyPage: vi.fn(),
}));
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
const { requestAgencyPage } = await import("@/components/useCertCheckExtension");

const MATCH = { ok: true, verdict: "match", effect: "certified" } as const;

const t = staffTranslator("en-US");
const copies = agencyCheckCopies(t);

function card(n: number, agency: "ssi" | "naui" | "padi" = "ssi"): AgencyCheckableCard {
  const [firstName, lastName] = ["Diver", `Number${n}`];
  return {
    certificationId: `card-${n}`,
    personId: `person-${n}`,
    fullName: `${firstName} ${lastName}`,
    agency,
    // Only what the agency's form asks for (`agencyCheckQuery`).
    query:
      agency === "ssi"
        ? { agency, firstName, lastName, birthDate: null, cardNumber: `SSI-${n}` }
        : { agency, firstName, lastName, birthDate: "1990-04-12", cardNumber: null },
  };
}

afterEach(() => {
  cleanup();
  vi.mocked(requestAgencyPage).mockReset();
  routerRefresh.mockReset();
  document.documentElement.removeAttribute("data-diveday-cert-check");
});

function withExtension() {
  document.documentElement.setAttribute("data-diveday-cert-check", "1.1.0");
}

/** A departure of these cards, one row per diver, under one host. */
function renderDeparture(
  cards: AgencyCheckableCard[],
  answer: (personId: string, formData: FormData) => AgencyCheckResult | Promise<AgencyCheckResult>,
) {
  const action = vi.fn(
    async (
      personId: string,
      _previous: AgencyCheckResult,
      form: FormData,
    ): Promise<AgencyCheckResult> => answer(personId, form),
  );
  render(
    <AgencyCheckHost action={action} copies={copies} pauseMs={0}>
      <AgencyCheckAll cards={cards} copy={agencyCheckAllCopy(t, cards.length)} />
      <ul>
        {cards.map((each) => (
          <li key={each.personId} data-testid={each.personId}>
            <AgencyCheckRow personId={each.personId} cards={[each]} />
          </li>
        ))}
      </ul>
    </AgencyCheckHost>,
  );
  return action;
}

const row = (personId: string) => within(screen.getByTestId(personId));

describe("AgencyCheckRow and AgencyCheckAll", () => {
  it("draw nothing without the extension", () => {
    renderDeparture([card(1), card(2)], () => MATCH);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offer each row's own check, and Check all for two or more", () => {
    withExtension();
    renderDeparture([card(1), card(2)], () => MATCH);
    expect(row("person-1").getByRole("button", { name: "Check with SSI" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check all 2 cards with their agencies" }),
    ).toBeVisible();
  });

  it("leave a lone card to its row", () => {
    withExtension();
    renderDeparture([card(1)], () => MATCH);
    expect(screen.queryByRole("button", { name: /Check all/ })).toBeNull();
  });

  it("check a whole departure one card at a time, leaving each match its own Undo", async () => {
    withExtension();
    let inFlight = 0;
    let most = 0;
    vi.mocked(requestAgencyPage).mockImplementation(async (query) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true, pageText: `page for ${query.lastName}` };
    });
    const action = renderDeparture([card(1), card(2), card(3)], (personId) =>
      personId === "person-2"
        ? { ok: true, verdict: "level_unconfirmed", evidence: "Diver Number2 — Scuba Diver" }
        : MATCH,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 3 cards with their agencies" }),
      );
    });

    expect(await screen.findByText("Checked 3. Certified: 2.")).toBeInTheDocument();
    expect(most).toBe(1);
    expect(action.mock.calls.map(([personId]) => personId)).toEqual([
      "person-1",
      "person-2",
      "person-3",
    ]);
    // Short of a match, the row keeps the page's words and the agency's link.
    expect(row("person-2").getByText("SSI found this diver, but not at this level.")).toBeVisible();
    expect(row("person-2").getByText("Diver Number2 — Scuba Diver")).toBeVisible();
    expect(row("person-2").getByRole("link", { name: "Check with SSI" })).toHaveAttribute(
      "href",
      "https://my.divessi.com/online_diver_check",
    );
    expect(row("person-2").queryByRole("button", { name: "Check with SSI" })).toBeNull();
    // Each match keeps its own Undo; there is none for the departure.
    expect(row("person-1").getByRole("button", { name: "Undo" })).toBeVisible();
    expect(row("person-3").getByRole("button", { name: "Undo" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);

    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Undo" }));
    });
    const undo = action.mock.calls.at(-1);
    if (!undo) throw new Error("Undo posted nothing");
    const [undoPerson, , undoForm] = undo;
    expect(undoPerson).toBe("person-1");
    expect(undoForm.get("intent")).toBe("undo");
    expect(undoForm.get("certificationId")).toBe("card-1");
  });

  /**
   * One diver the agency's page does not show is that diver's: named, with
   * the page to open, and the run goes on. Two in a row is the page itself.
   */
  it("skips one diver the page does not show, and stops on two in a row", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    const unreadable = new Set(["person-2", "person-4", "person-5"]);
    const action = renderDeparture(
      [1, 2, 3, 4, 5, 6].map((n) => card(n)),
      (personId) => (unreadable.has(personId) ? { ok: true, verdict: "unreadable" } : MATCH),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 6 cards with their agencies" }),
      );
    });

    expect(
      await screen.findByText(
        "Stopped at Diver Number5: couldn’t read SSI’s page. The rest are left for you.",
      ),
    ).toBeInTheDocument();
    expect(action.mock.calls.map(([personId]) => personId)).toEqual([
      "person-1",
      "person-2",
      "person-3",
      "person-4",
      "person-5",
    ]);
    expect(
      row("person-2").getByText("Couldn’t find Diver Number2 on SSI’s page. Open it and look."),
    ).toBeVisible();
    expect(row("person-2").getByRole("link", { name: "Check with SSI" })).toBeVisible();
    expect(row("person-6").getByRole("button", { name: "Check with SSI" })).toBeEnabled();
  });

  /** A re-run never stops at the same diver for the same reason: what this page settled stays settled. */
  it("skips on a re-run the cards this page already settled", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    const unreadable = new Set(["person-2", "person-3"]);
    const action = renderDeparture(
      [1, 2, 3, 4, 5].map((n) => card(n)),
      (personId) => (unreadable.has(personId) ? { ok: true, verdict: "unreadable" } : MATCH),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 5 cards with their agencies" }),
      );
    });
    expect(await screen.findByText(/^Stopped at Diver Number3/)).toBeInTheDocument();
    action.mockClear();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 2 cards with their agencies" }),
      );
    });

    expect(await screen.findByText("Checked 2. Certified: 2.")).toBeInTheDocument();
    expect(action.mock.calls.map(([personId]) => personId)).toEqual(["person-4", "person-5"]);
  });

  it("stops when the extension does not answer twice in a row, and sends the server nothing", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: false, reason: "timeout" });
    const action = renderDeparture([card(1), card(2), card(3)], () => MATCH);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 3 cards with their agencies" }),
      );
    });

    expect(
      await screen.findByText(
        "Stopped at Diver Number2: couldn’t read SSI’s page. The rest are left for you.",
      ),
    ).toBeInTheDocument();
    expect(row("person-1").getByText("Couldn’t read SSI’s page.")).toBeVisible();
    expect(action).not.toHaveBeenCalled();
    expect(vi.mocked(requestAgencyPage)).toHaveBeenCalledTimes(2);
  });

  /**
   * DiveDay's own server did not answer: the card may have been written, so
   * the row says to reload rather than blame the agency's page.
   */
  it("tells the staffer to reload when DiveDay does not answer, and stops on two in a row", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    renderDeparture([card(1), card(2), card(3)], () => {
      throw new Error("network");
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 3 cards with their agencies" }),
      );
    });

    expect(
      await screen.findByText(
        "Stopped at Diver Number2: DiveDay didn’t answer. Reload to see where each certification stands.",
      ),
    ).toBeInTheDocument();
    expect(
      row("person-1").getByText(
        "DiveDay didn’t answer. Reload to see where this certification stands.",
      ),
    ).toBeVisible();
    expect(row("person-1").queryByText("Couldn’t read SSI’s page.")).toBeNull();
  });

  it("stops when the staffer says so, after the card in flight, and says what it came to", async () => {
    withExtension();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(requestAgencyPage).mockImplementation(async () => {
      await held;
      return { ok: true, pageText: "page" };
    });
    const action = renderDeparture([card(1), card(2), card(3)], () => MATCH);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 3 cards with their agencies" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      release();
    });

    expect(await screen.findByText("Stopped. Checked 1. Certified: 1.")).toBeInTheDocument();
    expect(action.mock.calls.map(([personId]) => personId)).toEqual(["person-1"]);
    expect(row("person-2").getByRole("button", { name: "Check with SSI" })).toBeEnabled();
  });

  /** The page repaints once, when a run that wrote something ends, not after each card. */
  it("refreshes the page once at the end of a run, not after each card", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    const action = renderDeparture([card(1), card(2), card(3)], () => MATCH);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 3 cards with their agencies" }),
      );
    });

    expect(await screen.findByText("Checked 3. Certified: 3.")).toBeInTheDocument();
    expect(action.mock.calls.map(([, , form]) => form.get("refresh"))).toEqual([
      "later",
      "later",
      "later",
    ]);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("counts an imported card the agency confirmed apart from one it certified", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    renderDeparture([card(1), card(2)], (personId) =>
      personId === "person-2" ? { ...MATCH, effect: "confirmed" } : MATCH,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 2 cards with their agencies" }),
      );
    });

    expect(await screen.findByText("Checked 2. Certified: 1. Confirmed: 1.")).toBeInTheDocument();
    expect(row("person-2").getByText("SSI shows this certification. Confirmed.")).toBeVisible();
  });

  it("keeps the page's words and evidence off a printed roster", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    renderDeparture([card(1)], () => ({
      ok: true,
      verdict: "level_unconfirmed",
      evidence: "Diver Number1 · Scuba Diver",
    }));

    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with SSI" }));
    });

    const evidence = await row("person-1").findByText("Diver Number1 · Scuba Diver");
    expect(evidence.closest(".print\\:hidden")).not.toBeNull();
    expect(
      row("person-1")
        .getByText("SSI found this diver, but not at this level.")
        .closest(".print\\:hidden"),
    ).not.toBeNull();
  });

  it("offers PADI as a real check, in its own words, with the member sign-in link kept for after", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    renderDeparture([card(1, "padi")], () => ({ ok: true, verdict: "several_records" }));

    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with PADI" }));
    });

    expect(
      await row("person-1").findByText("PADI lists more than one diver by this name."),
    ).toBeVisible();
    expect(
      row("person-1").getByRole("link", { name: "Check with PADI (member sign-in)" }),
    ).toBeVisible();
    expect(row("person-1").queryByRole("button", { name: "Check with PADI" })).toBeNull();
  });

  it("tells a staffer signed out of PADI to sign in, and keeps the button for after", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: false, reason: "signed_out" });
    const action = renderDeparture([card(1, "padi")], () => MATCH);

    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with PADI" }));
    });

    expect(
      await row("person-1").findByText("Sign in to PADI first, then check again."),
    ).toBeVisible();
    expect(row("person-1").queryByText("Couldn’t read PADI’s page.")).toBeNull();
    expect(row("person-1").getByRole("button", { name: "Check with PADI" })).toBeEnabled();
    expect(action).not.toHaveBeenCalled();
  });

  it("stops Check all at the first PADI card when signed out of PADI, and says why", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockImplementation(async (query) =>
      query.agency === "padi"
        ? { ok: false, reason: "signed_out" }
        : { ok: true, pageText: "No results found" },
    );
    const action = renderDeparture([card(1), card(2, "padi"), card(3, "padi")], () => ({
      ok: true,
      verdict: "no_record",
    }));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 3 cards with their agencies" }),
      );
    });

    expect(
      await screen.findByText(
        "Stopped at Diver Number2: sign in to PADI first. The rest are left for you.",
      ),
    ).toBeInTheDocument();
    expect(vi.mocked(requestAgencyPage)).toHaveBeenCalledTimes(2);
    expect(action.mock.calls.map(([personId]) => personId)).toEqual(["person-1"]);
    expect(row("person-3").getByRole("button", { name: "Check with PADI" })).toBeEnabled();
  });

  it("answers a single row's match with the diver record's toast and its Undo", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    const action = renderDeparture([card(1), card(2)], () => MATCH);

    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with SSI" }));
    });

    const message = await screen.findByText("SSI shows this certification. Marked certified.");
    const toast = message.closest('[role="status"]');
    if (!(toast instanceof HTMLElement)) throw new Error("the match did not land as a toast");
    expect(within(toast).getByRole("button", { name: "Undo" })).toBeVisible();
    expect(action).toHaveBeenCalledTimes(1);
    // A single check's post repaints the page itself (the action's refresh()).
    expect(action.mock.calls[0]?.[2].get("refresh")).toBeNull();
    // Only the one card: the other row was never asked about.
    expect(vi.mocked(requestAgencyPage)).toHaveBeenCalledTimes(1);
  });

  it("says an imported card was confirmed, not certified, in the toast", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    renderDeparture([card(1), card(2)], () => ({ ...MATCH, effect: "confirmed" }));

    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with SSI" }));
    });

    expect(await screen.findByText("SSI shows this certification. Confirmed.")).toBeVisible();
    expect(screen.queryByText("SSI shows this certification. Marked certified.")).toBeNull();
  });
});
