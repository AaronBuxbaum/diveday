// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgencyCheckResult,
  AgencyListedAddResult,
} from "@/app/shop/[shopSlug]/divers/[personId]/agency-check-actions";
import { staffTranslator } from "@/i18n/staff-messages";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import { AgencyCheckAll } from "./AgencyCheckAll";
import { AgencyCheckHost, AgencyListedOffersSlot, agencyCheckCardsToRun } from "./AgencyCheckHost";
import { AgencyCheckRow } from "./AgencyCheckRow";
import { agencyCheckAllCopy, agencyCheckCopies } from "./agency-check-copy";

/**
 * **The agency check on a departure's Divers tab** (H-20261008-cert-check-extension): each row's own
 * button, and the departure's "Check all", one card at a time, skipping one
 * page it cannot read and stopping on two in a row, with a Stop, Undo on each
 * card and none for the boat.
 */

vi.mock("@/components/useCertCheckExtension", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/useCertCheckExtension")>()),
  requestAgencyPage: vi.fn(),
}));
vi.mock("@/app/actions/agency-check-report", () => ({
  reportAgencyCheckPageAction: vi.fn(async () => {}),
}));
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
const { requestAgencyPage } = await import("@/components/useCertCheckExtension");

const MATCH = { ok: true, verdict: "match", effect: "certified" } as const;

const t = staffTranslator("en-US");
const copies = agencyCheckCopies(t);

function card(n: number, agency: "ssi" | "naui" | "padi" = "naui"): AgencyCheckableCard {
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

it("leaves SSI's manual lookups out of Check all", () => {
  expect(agencyCheckCardsToRun([card(1, "ssi"), card(2, "naui")], {})).toEqual([card(2, "naui")]);
});

afterEach(() => {
  cleanup();
  vi.mocked(requestAgencyPage).mockReset();
  routerRefresh.mockReset();
  document.documentElement.removeAttribute("data-diveday-cert-check");
});

function withExtension() {
  document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
}

/** A departure of these cards, one row per diver, under one host. */
function renderDeparture(
  cards: AgencyCheckableCard[],
  answer: (personId: string, formData: FormData) => AgencyCheckResult | Promise<AgencyCheckResult>,
  options: {
    addListed?: (
      personId: string,
      previous: AgencyListedAddResult,
      formData: FormData,
    ) => Promise<AgencyListedAddResult>;
    offersAt?: "row" | "slot";
  } = {},
) {
  const action = vi.fn(
    async (
      personId: string,
      _previous: AgencyCheckResult,
      form: FormData,
    ): Promise<AgencyCheckResult> => answer(personId, form),
  );
  render(
    <AgencyCheckHost
      action={action}
      addListedAction={options.addListed}
      offersAt={options.offersAt}
      copies={copies}
      pauseMs={0}
    >
      <AgencyCheckAll cards={cards} copy={agencyCheckAllCopy(t, cards.length)} />
      <ul>
        {cards.map((each) => (
          <li key={each.personId} data-testid={each.personId}>
            <AgencyCheckRow personId={each.personId} cards={[each]} />
          </li>
        ))}
      </ul>
      {/* Where Today draws it, under its list; nothing unless the host offers there. */}
      <AgencyListedOffersSlot shopSlug="blue-mantis" />
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
    expect(row("person-1").getByRole("button", { name: "Check with NAUI" })).toBeInTheDocument();
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
    expect(
      row("person-2").getByText("NAUI found this diver, but not at this level."),
    ).toBeVisible();
    expect(row("person-2").getByText("Diver Number2 — Scuba Diver")).toBeVisible();
    expect(row("person-2").getByRole("link", { name: "Check with NAUI" })).toHaveAttribute(
      "href",
      "https://www.naui.org/services/verify-diver-certification/",
    );
    expect(row("person-2").queryByRole("button", { name: "Check with NAUI" })).toBeNull();
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
        "Stopped at Diver Number5: couldn’t read NAUI’s page. The rest are left for you.",
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
      row("person-2").getByText("Couldn’t find Diver Number2 on NAUI’s page. Open it and look."),
    ).toBeVisible();
    expect(row("person-2").getByRole("link", { name: "Check with NAUI" })).toBeVisible();
    expect(row("person-6").getByRole("button", { name: "Check with NAUI" })).toBeEnabled();
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
        "Stopped at Diver Number2: couldn’t read NAUI’s page. The rest are left for you.",
      ),
    ).toBeInTheDocument();
    expect(row("person-1").getByText("Couldn’t read NAUI’s page.")).toBeVisible();
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
    expect(row("person-1").queryByText("Couldn’t read NAUI’s page.")).toBeNull();
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
    expect(row("person-2").getByRole("button", { name: "Check with NAUI" })).toBeEnabled();
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
    expect(row("person-2").getByText("NAUI shows this certification. Confirmed.")).toBeVisible();
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
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with NAUI" }));
    });

    const evidence = await row("person-1").findByText("Diver Number1 · Scuba Diver");
    expect(evidence.closest(".print\\:hidden")).not.toBeNull();
    expect(
      row("person-1")
        .getByText("NAUI found this diver, but not at this level.")
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
      await row("person-1").findByText("Sign in to the PADI Pros’ Site first, then check again."),
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
        "Stopped at Diver Number2: sign in to the PADI Pros’ Site first. The rest are left for you.",
      ),
    ).toBeInTheDocument();
    expect(vi.mocked(requestAgencyPage)).toHaveBeenCalledTimes(2);
    expect(action.mock.calls.map(([personId]) => personId)).toEqual(["person-1"]);
    expect(row("person-3").getByRole("button", { name: "Check with PADI" })).toBeEnabled();
  });

  /** Domain review R7: a captcha is NAUI's state, so NAUI's other cards are left; NAUI's go on. */
  it("leaves an agency's other cards once its page asks whether the staffer is human", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockImplementation(async (query) =>
      query.agency === "naui" ? { ok: false, reason: "captcha" } : { ok: true, pageText: "page" },
    );
    const action = renderDeparture([card(1), card(2), card(3, "padi")], () => MATCH);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 3 cards with their agencies" }),
      );
    });

    expect(
      await screen.findByText(
        "Checked 2. Certified: 1. Left NAUI’s other certifications for you: check them on its page.",
      ),
    ).toBeInTheDocument();
    expect(vi.mocked(requestAgencyPage).mock.calls.map(([query]) => query.agency)).toEqual([
      "naui",
      "padi",
    ]);
    expect(action.mock.calls.map(([personId]) => personId)).toEqual(["person-3"]);
    expect(
      row("person-1").getByText("NAUI is asking if you’re human. Check on its page."),
    ).toBeVisible();
    expect(row("person-1").getByRole("link", { name: "Check with NAUI" })).toBeVisible();
    expect(row("person-1").queryByRole("button", { name: "Check with NAUI" })).toBeNull();
    expect(row("person-2").getByRole("button", { name: "Check with NAUI" })).toBeEnabled();
  });

  it("answers a single row's match with the diver record's toast and its Undo", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    const action = renderDeparture([card(1), card(2)], () => MATCH);

    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with NAUI" }));
    });

    const message = await screen.findByText("NAUI shows this certification. Marked certified.");
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
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with NAUI" }));
    });

    expect(await screen.findByText("NAUI shows this certification. Confirmed.")).toBeVisible();
    expect(screen.queryByText("NAUI shows this certification. Marked certified.")).toBeNull();
  });
});

/**
 * **The page's other cards, after a match** (layer 3): offered under the
 * diver's row, never while a "Check all" is still running, and posted back
 * with the page the server judged so it can judge it again.
 */
describe("the other cards a match's page lists", () => {
  const OFFERED = {
    ...MATCH,
    offers: [
      { kind: "nitrox", words: "Enriched Air Nitrox" },
      { kind: "deep", words: "Deep Diving" },
    ],
  } as const;

  it("waits for a Check all to finish, then offers them under each diver's row", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockImplementation(async (query) => ({
      ok: true,
      pageText: `page for ${query.lastName}`,
    }));
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const addListed = vi.fn(
      async (): Promise<AgencyListedAddResult> => ({ ok: true, added: ["deep"] }),
    );
    renderDeparture(
      [card(1), card(2)],
      async (personId) => {
        if (personId === "person-2") await held;
        return personId === "person-1" ? OFFERED : MATCH;
      },
      { addListed },
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check all 2 cards with their agencies" }),
      );
    });
    // The first diver matched; the run is still on the second: no offer yet.
    expect(row("person-1").queryByText(/also shows these certifications/)).toBeNull();

    await act(async () => {
      release();
      await held;
    });
    expect(await screen.findByText("Checked 2. Certified: 2.")).toBeInTheDocument();
    const offer = row("person-1");
    expect(
      offer.getByText(
        "NAUI also shows these certifications. Add them? Each waits for Mark certified.",
      ),
    ).toBeVisible();
    expect(row("person-2").queryByText(/also shows/)).toBeNull();

    // Untick nitrox, add Deep: the same page goes back with the one tick.
    fireEvent.click(offer.getByRole("checkbox", { name: "Enriched Air Nitrox" }));
    await act(async () => {
      fireEvent.click(offer.getByRole("button", { name: "Add" }));
    });
    expect(addListed).toHaveBeenCalledTimes(1);
    const [personId, , form] = addListed.mock.calls[0] as unknown as [string, null, FormData];
    expect(personId).toBe("person-1");
    expect(form.get("certificationId")).toBe("card-1");
    expect(form.get("pageText")).toBe("page for Number1");
    expect(form.getAll("kind")).toEqual(["deep"]);
    expect(await offer.findByText("Added")).toBeVisible();
    // Filed: the offer stays, saying so, and the page's text is not kept to post again.
    expect(offer.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("offers nothing where no action can file them", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    renderDeparture([card(1)], () => OFFERED);
    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with NAUI" }));
    });
    expect(screen.queryByText(/also shows/)).toBeNull();
  });

  it("offers them under the list, naming the diver with a link to their record, where the row may leave (Today)", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    const addListed = vi.fn(async (): Promise<AgencyListedAddResult> => ({ ok: false }));
    renderDeparture([card(1)], () => OFFERED, { addListed, offersAt: "slot" });
    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with NAUI" }));
    });
    expect(row("person-1").queryByText(/also shows/)).toBeNull();
    const offer = screen.getByRole("group", {
      name: "NAUI also shows these certifications for Diver Number1. Add them? Each waits for Mark certified.",
    });
    // Below the list, never above it.
    const list = screen.getByRole("list");
    expect(list.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(offer).getByRole("link", { name: "Diver Number1" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-1",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });
    expect(
      await screen.findByText("Couldn’t add them. Reload to see this diver’s certifications."),
    ).toBeVisible();
  });

  it("draws nothing in the slot where offers go under each row", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    const addListed = vi.fn(async (): Promise<AgencyListedAddResult> => ({ ok: true, added: [] }));
    renderDeparture([card(1)], () => OFFERED, { addListed });
    await act(async () => {
      fireEvent.click(row("person-1").getByRole("button", { name: "Check with NAUI" }));
    });
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(row("person-1").getByRole("group")).toBeVisible();
  });
});

/**
 * **A diver's nitrox and specialty cards on the same row** (issue #2592): each
 * wears its own kind's words, posts the table it is in, and keeps its own
 * Undo, so two cards at one agency can never be taken for one another.
 */
describe("AgencyCheckRow with a nitrox card beside a level card", () => {
  const level = card(1);
  const nitrox: AgencyCheckableCard = {
    ...card(1),
    certificationId: "card-nitrox",
    cardType: "nitrox",
    kind: "nitrox",
  };

  it("words each button by its card, and posts the table with the check and the Undo", async () => {
    withExtension();
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: true, pageText: "page" });
    const action = vi.fn(
      async (): Promise<AgencyCheckResult> => ({
        ok: true,
        verdict: "match",
        effect: "certified",
        undo: { certificationId: "card-nitrox" },
      }),
    );
    render(
      <AgencyCheckHost action={action} copies={copies} pauseMs={0}>
        <AgencyCheckRow personId="person-1" cards={[level, nitrox]} />
      </AgencyCheckHost>,
    );
    expect(screen.getByRole("button", { name: "Check with NAUI" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check Nitrox with NAUI" }));
    });
    const [, , posted] = action.mock.calls[0] as unknown as [string, unknown, FormData];
    expect(posted.get("certificationId")).toBe("card-nitrox");
    expect(posted.get("cardType")).toBe("nitrox");

    // The level card's check posts no table at all.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check with NAUI" }));
    });
    const [, , levelPosted] = action.mock.calls[1] as unknown as [string, unknown, FormData];
    expect(levelPosted.has("cardType")).toBe(false);
  });
});
