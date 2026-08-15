// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DeclaredDiveProfile } from "@/db/self-declared-cards";
import type { CertRequirementSource } from "@/lib/readiness";
import { type LastMinuteDealRecipient, LastMinuteDealSection } from "./LastMinuteDealSection";

afterEach(cleanup);

function profile(
  level: DeclaredDiveProfile["level"],
  selfDeclared = false,
): DeclaredDiveProfile | null {
  if (!level) return null;
  return { level, levelSelfDeclared: selfDeclared, nitrox: false, nitroxSelfDeclared: false };
}

function recipient(
  fullName: string,
  level: DeclaredDiveProfile["level"],
  selfDeclared = false,
): LastMinuteDealRecipient {
  return { personId: `p-${fullName}`, fullName, profile: profile(level, selfDeclared) };
}

function requires(minimumCertificationLevel: CertRequirementSource["minimumCertificationLevel"]) {
  return { minimumCertificationLevel, requiredSpecialties: [], requiresNitrox: false };
}

function renderSection(
  recipients: LastMinuteDealRecipient[],
  requirement: CertRequirementSource | null,
) {
  return render(
    <LastMinuteDealSection
      shopSlug="blue-mantis"
      recipients={recipients}
      requirement={requirement}
      openSeats={4}
      cancelled={false}
      promos={[]}
      timezone="America/New_York"
      locale="en-US"
      sendAction={() => {}}
    />,
  );
}

/**
 * **What a staffer can see at the moment they decide to send.**
 *
 * Nothing filters this blast — that is the decision, argued in ADR
 * 20260814-self-declared-cards — so the entire safeguard is that the levels are
 * legible *before* the button. A dive-domain review found the panel defeating
 * its own purpose: the list rendered after `SubmitButton`, unbounded, with the
 * trip's own bar nowhere on the screen. These are the four properties that
 * stop it going back.
 */
describe("LastMinuteDealSection recipient review", () => {
  it("puts the recipient list ahead of the send button in DOM order", () => {
    const { container } = renderSection([recipient("Ravi Menon", "open_water")], requires(null));

    const list = container.querySelector("ul");
    const send = screen.getByRole("button", { name: /Send to/ });
    expect(list).not.toBeNull();
    // Reading order, not visual order: a screen reader has to meet the people
    // before it meets the control, so an `order-*` class would not do.
    expect(
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
      list!.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("states what the departure requires, above the list", () => {
    const { container } = renderSection(
      [recipient("Ravi Menon", "open_water")],
      requires("advanced_open_water"),
    );

    const requirement = screen.getByText("This departure requires Advanced Open Water or higher.");
    const list = container.querySelector("ul");
    expect(
      // biome-ignore lint/style/noNonNullAssertion: the list always renders when there is somebody to send to.
      requirement.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says nothing about a requirement when the departure has none", () => {
    const { container } = renderSection([recipient("Ravi Menon", "open_water")], requires(null));

    // No empty scaffolding: a departure that demands nothing gets no sentence
    // about its demands, and the summary says the useful thing instead.
    expect(container.textContent).not.toContain("This departure requires");
    expect(container.textContent).toContain(
      "This departure asks for no certification level, so nobody on this list is below it.",
    );
  });

  it("summarizes who is below the bar and who said nothing", () => {
    const { container } = renderSection(
      [
        recipient("Hana Kobayashi", "advanced_open_water"),
        recipient("Ravi Menon", "open_water"),
        recipient("Tess Alvarez", "open_water", true),
        recipient("Amara Osei", null),
      ],
      requires("advanced_open_water"),
    );

    // One paragraph, two whole ICU sentences — never a concatenation, and with
    // the space between them that a run-together "requirement.1 said" loses.
    expect(container.textContent).toContain(
      "2 of 4 said a level below this departure's requirement. 1 said nothing about their level.",
    );
  });

  it("answers with nobody rather than a zero when the whole list clears the bar", () => {
    const { container } = renderSection(
      [recipient("Hana Kobayashi", "advanced_open_water")],
      requires("advanced_open_water"),
    );

    expect(container.textContent).toContain(
      "Nobody on this list said a level below this departure's requirement.",
    );
    expect(container.textContent).not.toContain("said nothing about their level");
  });

  it("caps the drawn list, counts the rest, and never hides someone below the bar", () => {
    const many = [
      ...Array.from({ length: 11 }, (_, index) => recipient(`Instructor ${index}`, "instructor")),
      // Last in send order, and the one name that should stop this send.
      recipient("Ravi Menon", "open_water"),
    ];

    const { container } = renderSection(many, requires("rescue"));

    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(10);
    expect(rows[0]?.textContent).toContain("Ravi Menon");
    expect(container.textContent).toContain(
      "2 more aren't shown — anyone below the requirement is listed first.",
    );
    // The send is untouched by the cap: the button still offers everybody.
    expect(screen.getByRole("button", { name: "Send to 12 divers" })).toBeDefined();
  });
});
