// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { signTripAdmissionGate } from "@/lib/trip-admission-gate";
import { DiverFormStatus, NoticeBanner, resolveDiverNotice } from "./NoticeBanner";

afterEach(cleanup);

const PERSON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PERSON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function resolve(
  notice?: string,
  extra: { gate?: string | string[]; form?: string; personId?: string } = {},
) {
  const { personId = PERSON, ...rest } = extra;
  return resolveDiverNotice({ notice, personId, locale: "en-US", ...rest });
}

/** The page-level banner, rendering whatever `resolveDiverNotice` produced. */
function renderBanner(notice?: string, gate?: string | string[], personId = PERSON) {
  return render(
    <NoticeBanner
      notice={resolveDiverNotice({ notice, gate, personId, locale: "en-US" })}
      shopSlug="reef-shop"
      locale="en-US"
    />,
  );
}

/** A section's own action-row line, which is where most notices now land. */
function renderStatus(notice?: string, form?: string) {
  return render(
    <DiverFormStatus
      status={resolveDiverNotice({ notice, form, personId: PERSON, locale: "en-US" })}
      shopSlug="reef-shop"
      locale="en-US"
    />,
  );
}

describe("NoticeBanner", () => {
  it("renders nothing without a notice", () => {
    const { container } = renderBanner(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a known notice", () => {
    renderBanner("booked");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  /**
   * A refusal is an `alert`, a confirmation a `status` — the shared tone→role
   * rule (`noticeRole`). The old banner hard-coded `role="status"`, which
   * announced a refusal as ambient chatter.
   */
  it("announces a refusal as an alert, not as ambient status", () => {
    renderBanner("invalid");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  /**
   * `notice` comes straight off the query string. A bare `NOTICE_KEYS[notice]`
   * resolves `constructor` to `Object.prototype.constructor` — a function —
   * and React throws trying to render it as a child. `noticeFromParam` is what
   * stops that; this is the test that keeps it in place.
   */
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "renders nothing for a hostile ?notice=%s",
    (hostile) => {
      const { container } = renderBanner(hostile);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("renders nothing for an unrecognized notice", () => {
    const { container } = renderBanner("definitely-not-a-notice");
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * **`?gate=` must be evidence, not an instruction** (security review
   * finding).
   *
   * This is the surface the old static copy sent staff to ("Add the missing
   * card above"), which makes it the one where a *forged* specific refusal does
   * the most damage: "their Deep card isn't on file" points a staffer straight
   * at the certifications form, and a hand-entered card lands `pending` — which
   * clears `decideTripAdmission` on the next attempt (H-24). So a value nobody
   * signed must degrade to the generic sentence, and never to the specific one
   * or to nothing at all.
   */
  describe("trip-prerequisite's structured detail", () => {
    const deepCardRefusal = {
      requiredLevel: null,
      heldLevel: null,
      missingSpecialties: ["deep" as const],
      nitroxRequired: false,
    };

    it("says which card is missing when the gate is signed for this diver", () => {
      renderBanner(
        "trip-prerequisite",
        signTripAdmissionGate(deepCardRefusal, { kind: "diver", id: PERSON }),
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This charter requires a Deep certification. There's none on this diver's record.",
      );
    });

    it("falls back to the generic sentence on a hand-written gate", () => {
      // The exact forgery from the review: well-formed to the codec, signed by
      // nobody.
      renderBanner("trip-prerequisite", "~~deep~0");
      const banner = screen.getByRole("alert");
      expect(banner).toHaveTextContent(
        "This diver's certifications on file don't reach what that trip and its dive sites require",
      );
      expect(banner).not.toHaveTextContent("Deep certification");
    });

    it("falls back to the generic sentence on another diver's genuine gate", () => {
      renderBanner(
        "trip-prerequisite",
        signTripAdmissionGate(deepCardRefusal, { kind: "diver", id: OTHER_PERSON }),
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("Deep certification");
    });

    it("still renders — never blank — when the gate is absent", () => {
      renderBanner("trip-prerequisite");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This diver's certifications on file don't reach what that trip and its dive sites require",
      );
    });

    it("renders rather than throwing on a repeated ?gate=", () => {
      expect(() => renderBanner("trip-prerequisite", ["~~deep~0", "~~wreck~0"])).not.toThrow();
      expect(screen.getByRole("alert")).not.toHaveTextContent("Deep certification");
    });

    /**
     * The verified refusal is worth nothing if it lands two screens from the
     * picker that produced it — this is the code a staffer most needs beside
     * the control they just used, because the next move is choosing a different
     * trip.
     */
    it("belongs to the booking form, not to the page", () => {
      expect(resolve("trip-prerequisite")?.form).toBe("book-activity");
    });
  });

  /**
   * The dead-button bug: `orders/new` bounces a shop with no payable Stripe
   * account back here with `?notice=payment-not-connected`. Before this code
   * existed in the map, that render produced nothing at all — the "New
   * payment" button visibly did nothing, every time, on every day-one shop.
   */
  describe("payment-not-connected", () => {
    it("explains why the invoice door refused, beside the door", () => {
      renderStatus("payment-not-connected");
      expect(screen.getByRole("status")).toHaveTextContent(/Payments aren't connected yet/i);
      expect(resolve("payment-not-connected")?.form).toBe("payments");
    });

    it("keeps its link to the settings section that fixes it, wherever it renders", () => {
      renderStatus("payment-not-connected");
      expect(screen.getByRole("link", { name: "Connect payments" })).toHaveAttribute(
        "href",
        "/shop/reef-shop/settings#money",
      );
      cleanup();
      renderBanner("payment-not-connected");
      expect(screen.getByRole("link", { name: "Connect payments" })).toHaveAttribute(
        "href",
        "/shop/reef-shop/settings#money",
      );
    });
  });
});

/**
 * **The routing half.** This record is nine independent forms on one ~6,400px
 * scroll — details, level cards, specialty cards, rental fit, payments, book an
 * activity, remove, erase — and every one of their outcomes used to resolve
 * into a single banner under the `<h1>`. Save a rental fit halfway down the
 * page and the confirmation appeared off-screen above you.
 */
describe("resolveDiverNotice", () => {
  it("sends each code home to the form that produced it", () => {
    expect(resolve("person-saved")?.form).toBe("details");
    expect(resolve("duplicate")?.form).toBe("details");
    expect(resolve("profile-saved")?.form).toBe("fit");
    expect(resolve("fit-flagged")?.form).toBe("fit");
    expect(resolve("not-authorized-fit")?.form).toBe("fit");
    expect(resolve("refunded")?.form).toBe("payments");
    expect(resolve("refund-failed")?.form).toBe("payments");
    // A second tap refused locally while the first refund is still at Stripe
    // (PAY-L3) — a warning beside the payments form, never a page banner.
    expect(resolve("refund-in-progress")?.form).toBe("payments");
    expect(resolve("refund-in-progress")?.tone).toBe("warning");
    // Warning, never danger: a refund Stripe already paid out must not read as
    // a failure, which is an invitation to press again (issue #699).
    expect(resolve("refund-needs-reconciliation")?.form).toBe("payments");
    expect(resolve("refund-needs-reconciliation")?.tone).toBe("warning");
    expect(resolve("booked")?.form).toBe("book-activity");
    expect(resolve("course-min-age")?.form).toBe("book-activity");
    expect(resolve("not-authorized-delete")?.form).toBe("remove");
    // A successful restore unmounts the restore card — the diver stops being
    // removed — so its confirmation has to live on the page or nobody sees it.
    // The refusal keeps the card (the restore failed) and stays on it.
    expect(resolve("restored")?.form).toBe("page");
    expect(resolve("restore-refused")?.form).toBe("restore");
    expect(resolve("erase-name-mismatch")?.form).toBe("erase");
  });

  /**
   * The card-sighting refusal came back, narrower.
   *
   * It was removed when confirming an **imported** card became one tap again
   * (ADR 20260814-one-tap-imported-card-confirm) — at that point nothing in the
   * domain layer could produce it, and this test asserted exactly that. A
   * **self-declared** card then reintroduced the only case that still needs it:
   * a level a diver typed about themselves, with no number behind it, which
   * must not inherit the one tap every staff-captured card gets
   * (ADR 20260814-self-declared-cards).
   */
  it("knows the card-sighting refusal again, for self-declared cards only", () => {
    expect(resolve("card-sighting-required")?.form).toBe("cards");
    expect(resolve("card-sighting-required")?.tone).toBe("danger");
    // It says what to do, not merely that something was refused: the staffer is
    // one field away from certifying the card properly.
    expect(resolve("card-sighting-required")?.text).toMatch(/agency and number/);
    // Confirming an imported card is still one tap, and still cannot raise it.
    expect(resolve("imported-card-sighting-required")).toBeUndefined();
  });

  it("lets an action name the form when the code alone cannot", () => {
    // The level-card form and the specialty form emit the same codes; only the
    // action that ran knows which list the staffer was looking at.
    expect(resolve("verified")?.form).toBe("cards");
    expect(resolve("verified", { form: "specialty-cards" })?.form).toBe("specialty-cards");
    expect(resolve("card-restore-conflict", { form: "specialty-cards" })?.form).toBe(
      "specialty-cards",
    );
    // `invalid` has no home of its own — half a dozen actions emit it.
    expect(resolve("invalid")?.form).toBe("page");
    expect(resolve("invalid", { form: "fit" })?.form).toBe("fit");
    expect(resolve("invalid", { form: "details" })?.form).toBe("details");
  });

  it("ignores a ?form= naming no form on this page", () => {
    // A query param is attacker-supplied: an unknown name must degrade to the
    // code's own home rather than routing the notice into a section nothing
    // renders, which would lose it entirely.
    expect(resolve("invalid", { form: "constructor" })?.form).toBe("page");
    expect(resolve("person-saved", { form: "../../etc" })?.form).toBe("details");
    expect(resolve("verified", { form: "__proto__" })?.form).toBe("cards");
  });

  /**
   * A pure "it worked" — the new pending row is the confirmation, so the code
   * still routes (`form`/`tone` resolve normally, `?form=` still overrides)
   * but carries nothing to say (copy-restraint deletion #1).
   */
  it("keeps captured's routing but withholds its text", () => {
    expect(resolve("captured")).toMatchObject({ form: "cards", tone: "success", silent: true });
    expect(resolve("captured")?.text).toBe("");
    expect(resolve("captured", { form: "specialty-cards" })?.form).toBe("specialty-cards");
  });

  /**
   * The same treatment, and the same reason: the card row visibly changes to
   * "certified". Only the card-sighting form still redirects with this code —
   * the one-tap review posts in place and answers with an undo toast — so
   * "Certification marked verified. It counts toward readiness." is gone,
   * along with the sentence explaining a status word the row already wore.
   */
  it("withholds verified's text too, now that the row is the confirmation", () => {
    expect(resolve("verified")).toMatchObject({ form: "cards", tone: "success", silent: true });
    expect(resolve("verified")?.text).toBe("");
  });

  it("puts the refusals that belong to one box on that box", () => {
    // These two the server can point at exactly, so they render on the control
    // rather than beside the button (`Field`'s `error`).
    expect(resolve("duplicate")?.field).toBe("diver-email");
    expect(resolve("erase-name-mismatch")?.field).toBe("erase-confirm-name");
    // Everything else is a form-level outcome with no single box to blame.
    expect(resolve("person-saved")?.field).toBeUndefined();
    expect(resolve("invalid")?.field).toBeUndefined();
  });

  it("still refuses an unrecognized notice code outright", () => {
    expect(resolve("constructor")).toBeUndefined();
    expect(resolve(undefined)).toBeUndefined();
  });
});

describe("DiverFormStatus", () => {
  it("renders nothing at rest, so a form's action row keeps its layout", () => {
    const { container } = render(
      <DiverFormStatus status={undefined} shopSlug="reef-shop" locale="en-US" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("announces a section's refusal as an alert and its confirmation as status", () => {
    renderStatus("not-authorized-fit");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    cleanup();
    renderStatus("profile-saved");
    expect(screen.getByRole("status")).toHaveTextContent("Rental fit profile saved");
  });
});
