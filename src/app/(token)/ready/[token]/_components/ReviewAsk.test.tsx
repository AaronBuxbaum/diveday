// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { noop, t } from "./after-state-test-fixtures";
import { ReviewAsk } from "./ReviewAsk";

afterEach(cleanup);

const submit = () => screen.getByRole("button", { name: "reviews.submit" });

describe("ReviewAsk", () => {
  it("is the page's primary at rest", () => {
    render(
      <ReviewAsk
        t={t}
        notice={undefined}
        ownReview={null}
        crewChoices={[]}
        stepsBack={false}
        action={noop}
      />,
    );
    expect(submit().className.split(/\s+/)).toContain("bg-primary");
  });

  it("steps back to secondary while the Google door is lit", () => {
    render(
      <ReviewAsk
        t={t}
        notice={undefined}
        ownReview={null}
        crewChoices={[]}
        stepsBack={true}
        action={noop}
      />,
    );
    expect(submit().className.split(/\s+/)).not.toContain("bg-primary");
  });

  it("keeps the diver's own rating and words when they come back", () => {
    render(
      <ReviewAsk
        t={t}
        notice={{ tone: "success", key: "reviews.savedPublished" }}
        ownReview={{ rating: 4, comment: "Great crew" } as never}
        crewChoices={[]}
        stepsBack={false}
        action={noop}
      />,
    );
    expect(screen.getByText("reviews.savedPublished")).toBeTruthy();
    expect(screen.getByText("reviews.yourRating(4)")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Great crew");
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("reviews.usageHint");
  });

  it("thanks a crew member with one tap, and offers Nobody only to take one back", () => {
    const crewChoices = [
      { choice: "a".repeat(22), name: "Keiko" },
      { choice: "b".repeat(22), name: "Sam" },
    ];
    render(
      <ReviewAsk
        t={t}
        notice={undefined}
        ownReview={null}
        crewChoices={crewChoices}
        stepsBack={false}
        action={noop}
      />,
    );
    expect(screen.getByRole("radio", { name: "Keiko" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Sam" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "reviews.thanksNobody" })).toBeNull();

    cleanup();
    render(
      <ReviewAsk
        t={t}
        notice={undefined}
        ownReview={{ rating: 5, crewThanks: null, crewThanksChoice: "b".repeat(22) } as never}
        crewChoices={crewChoices}
        stepsBack={false}
        action={noop}
      />,
    );
    expect((screen.getByRole("radio", { name: "Sam" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: "reviews.thanksNobody" })).toBeTruthy();
  });
});
