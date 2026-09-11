// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayLinksPanel } from "./DisplayLinksPanel";
import type { DisplayLinkCopy, DisplayLinkState, DisplayLinkView } from "./display-panel-types";

/**
 * The real action is a server action, and what this file is about is what the
 * panel does with its answer — so the stub simply refuses, reporting which of
 * the panel's two forms was posted.
 */
vi.mock("./actions", () => ({
  displayLinkAction: async (
    _previous: DisplayLinkState,
    formData: FormData,
  ): Promise<DisplayLinkState> =>
    formData.get("intent") === "revoke"
      ? { status: "denied", intent: "revoke" }
      : formData.get("intent") === "renew"
        ? { status: "denied", intent: "renew" }
        : { status: "denied", intent: "issue" },
}));

afterEach(cleanup);

const copy: DisplayLinkCopy = {
  createHeading: "Add a screen",
  labelField: "Which screen",
  labelPlaceholder: "Lobby TV",
  purposeLegend: "What this link opens",
  purposeBoard: "Departures board",
  purposeCheckIn: "Self check-in",
  purposeCheckInDescription: "A check-in tablet records that a diver has arrived.",
  showNames: "Show the crew’s names",
  showNamesDescription: "Only the crew who agreed to be named appear.",
  submit: "Create link",
  submitting: "Creating…",
  newLinkHeading: "Open this on the screen",
  shownOnce: "Shown once.",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",
  shared: "Anyone in the room reads them.",
  sharedCheckIn: "Anyone with this link can mark a diver as arrived without signing in.",
  listHeading: "Screens",
  listEmpty: "No screens yet.",
  namesOn: "Names on",
  namesOff: "Names off",
  neverShown: "Never opened",
  revoke: "Revoke",
  revoking: "Revoking…",
  confirmRevoke: "Revoke this screen’s link?",
  confirmRevokeButton: "Yes, revoke it",
  cancel: "Cancel",
  renew: "Renew",
  renewing: "Renewing…",
  denied: "That didn’t work.",
  invalidLabel: "Name the screen.",
  revoked: "Link revoked.",
  renewed: "Link renewed.",
  expiresCheckIn: "It stops working in 6 months.",
};

function screenRow(id: string, label: string, expiresLabel: string | null = null): DisplayLinkView {
  return {
    id,
    label,
    purposeLabel: copy.purposeBoard,
    showNamesLabel: copy.namesOff,
    createdLabel: `Created ${label}`,
    lastShownLabel: null,
    // Built on the server beside the other per-screen strings; see page.tsx.
    revokeLabel: `Revoke ${label}`,
    expiresLabel,
    renewLabel: `Renew ${label}`,
  };
}

const SCREENS = [
  screenRow("aaaaaaaa-1111-4222-8333-444444444444", "Lobby TV"),
  screenRow("bbbbbbbb-1111-4222-8333-444444444444", "Dock B tablet"),
];

const panel = (screens: DisplayLinkView[] = SCREENS) => (
  <DisplayLinksPanel copy={copy} screens={screens} maxLabelLength={40} />
);

/**
 * **A row's revoke has to name the row.** The screen's own name is a sibling
 * paragraph inside the `<li>` but outside the button, so it is not part of the
 * accessible name — two screens announced as "Revoke, button" twice, and a
 * screen-reader user choosing between them had nothing to choose by.
 */
describe("the revoke button's accessible name", () => {
  it("names its own screen while every visible label stays 'Revoke'", () => {
    render(panel());

    expect(screen.getByRole("button", { name: "Revoke Lobby TV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke Dock B tablet" })).toBeInTheDocument();

    // Distinct names, not merely two buttons: two identical names would also
    // give a count of two, and that is the defect.
    const names = screen
      .getAllByRole("button", { name: /^Revoke / })
      .map((button) => button.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);

    // Nothing on screen changed — the label a sighted staffer reads is still
    // the short one.
    for (const button of screen.getAllByRole("button", { name: /^Revoke / })) {
      expect(button).toHaveTextContent("Revoke");
    }
  });
});

/**
 * **A refusal belongs beside the thing it refused.** One `useActionState`
 * drives the create form and every revoke, so a refused revoke used to print
 * its message under the create form — a message about something the staffer
 * never submitted, in a card they were not looking at.
 */
describe("where a refusal lands", () => {
  it("puts a refused revoke on the Screens card, not under the create form", async () => {
    render(panel());

    await userEvent.click(screen.getByRole("button", { name: "Revoke Lobby TV" }));
    await userEvent.click(screen.getByRole("button", { name: copy.confirmRevokeButton }));

    // Found by its words inside the Screens card, never by `findByRole("alert")`
    // alone: `InlineConfirm`'s own "Revoke this screen’s link?" prompt is also
    // an alert and is still mounted at this moment, so a bare role lookup
    // resolves to whichever won the race. It did locally and lost on CI.
    const list = screen.getByRole("region", { name: copy.listHeading });
    const notice = await within(list).findByText(copy.denied);
    // Announced, not merely printed.
    expect(notice.closest('[role="alert"]')).not.toBeNull();
    // And not also under the create form.
    expect(
      within(screen.getByRole("region", { name: copy.createHeading })).queryByText(copy.denied),
    ).toBeNull();
    expect(screen.getAllByText(copy.denied)).toHaveLength(1);
  });

  it("keeps a refused create under the create form", async () => {
    render(panel());

    await userEvent.type(screen.getByLabelText(copy.labelField), "Lobby TV");
    await userEvent.click(screen.getByRole("radio", { name: copy.purposeBoard }));
    await userEvent.click(screen.getByRole("button", { name: copy.submit }));

    expect(await screen.findByText(copy.denied)).toBeInTheDocument();
    // `FormStatus` is itself an alert, so the role alone proves nothing here —
    // what matters is which card it landed in. Not the Screens list.
    expect(
      within(screen.getByRole("region", { name: copy.listHeading })).queryByText(copy.denied),
    ).toBeNull();
    expect(
      within(screen.getByRole("region", { name: copy.createHeading })).getByText(copy.denied),
    ).toBeInTheDocument();
    expect(screen.getAllByText(copy.denied)).toHaveLength(1);
  });
});

/**
 * **Which surface a link opens is a choice, and it has no default.** The two
 * grant different things — the board is read-only, the kiosk records an
 * arrival — so a staffer who never looked at this control must not walk away
 * holding the one that writes. Neither radio starts checked, and the browser's
 * own `required` is what stops an unanswered form.
 */
describe("the purpose choice", () => {
  it("offers both surfaces, pre-selects neither, and requires an answer", () => {
    render(panel());

    const board = screen.getByRole("radio", { name: copy.purposeBoard });
    const kiosk = screen.getByRole("radio", { name: copy.purposeCheckIn });
    expect(board).not.toBeChecked();
    expect(kiosk).not.toBeChecked();
    expect(board).toBeRequired();
    expect(kiosk).toBeRequired();
    // One control, so answering it once answers it.
    expect(board).toHaveAttribute("name", kiosk.getAttribute("name"));
    // And the tablet's consequence is spelled out beside the choice, not left
    // for a staffer to infer from the words "Self check-in".
    expect(
      within(screen.getByRole("region", { name: copy.createHeading })).getByText(
        copy.purposeCheckInDescription,
      ),
    ).toBeInTheDocument();
  });
});

/**
 * **A control that changes nothing must not be offered.** Nothing reads
 * `showNames` for a check-in link — the Screens list below already renders no
 * names label for one — so a manager ticking it on the kiosk form was told they
 * had made a choice they had not made (issue #1611).
 */
describe("the crew-names checkbox", () => {
  it("appears for a board link and not for a check-in link", async () => {
    render(panel());

    // Unanswered: no purpose, so nothing to configure for it yet.
    expect(screen.queryByLabelText(copy.showNames)).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: copy.purposeBoard }));
    expect(screen.getByLabelText(copy.showNames)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: copy.purposeCheckIn }));
    expect(screen.queryByLabelText(copy.showNames)).toBeNull();

    // And back, because a manager changing their mind twice is ordinary.
    await userEvent.click(screen.getByRole("radio", { name: copy.purposeBoard }));
    expect(screen.getByLabelText(copy.showNames)).toBeInTheDocument();
  });
});

/**
 * **A link that expires says when, and offers the one repair.** A kiosk whose
 * URL quietly stopped working is a tablet nobody can explain, so the row that
 * has a lifetime prints it and carries a Renew beside the Revoke. A board link
 * has no lifetime at all (issue #1609), and a Renew on it would offer a repair
 * for a failure that cannot happen.
 */
describe("an expiring link's row", () => {
  const KIOSK = screenRow(
    "cccccccc-1111-4222-8333-444444444444",
    "Counter tablet",
    "Expires 12 Mar 2027",
  );
  const BOARD = screenRow("aaaaaaaa-1111-4222-8333-444444444444", "Lobby TV");

  it("prints its expiry and offers Renew; a board row does neither", () => {
    render(panel([KIOSK, BOARD]));

    const list = screen.getByRole("region", { name: copy.listHeading });
    expect(within(list).getByText(/Expires 12 Mar 2027/)).toBeInTheDocument();

    // Named, like Revoke is: two rows announcing "Renew, button" would give a
    // screen-reader user nothing to choose by.
    const renew = screen.getByRole("button", { name: "Renew Counter tablet" });
    expect(renew).toHaveTextContent(copy.renew);
    expect(screen.queryByRole("button", { name: "Renew Lobby TV" })).toBeNull();
    // Exactly one Renew on the page, so the board row grew nothing.
    expect(screen.getAllByRole("button", { name: /^Renew / })).toHaveLength(1);
  });

  it("puts a refused renew on the Screens card, not under the create form", async () => {
    render(panel([KIOSK]));

    await userEvent.click(screen.getByRole("button", { name: "Renew Counter tablet" }));

    const list = screen.getByRole("region", { name: copy.listHeading });
    const notice = await within(list).findByText(copy.denied);
    expect(notice.closest('[role="alert"]')).not.toBeNull();
    expect(
      within(screen.getByRole("region", { name: copy.createHeading })).queryByText(copy.denied),
    ).toBeNull();
  });
});
