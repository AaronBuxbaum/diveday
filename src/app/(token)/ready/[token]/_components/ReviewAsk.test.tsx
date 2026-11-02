// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { noop, t } from "./after-state-test-fixtures";
import { ReviewAsk } from "./ReviewAsk";

afterEach(cleanup);

const submit = () => screen.getByRole("button", { name: "reviews.submit" });

describe("ReviewAsk", () => {
  it("is the page's primary at rest", () => {
    render(<ReviewAsk t={t} notice={undefined} ownReview={null} stepsBack={false} action={noop} />);
    expect(submit().className.split(/\s+/)).toContain("bg-primary");
  });

  it("steps back to secondary while the Google door is lit", () => {
    render(<ReviewAsk t={t} notice={undefined} ownReview={null} stepsBack={true} action={noop} />);
    expect(submit().className.split(/\s+/)).not.toContain("bg-primary");
  });

  it("keeps the diver's own rating and words when they come back", () => {
    render(
      <ReviewAsk
        t={t}
        notice={{ tone: "success", key: "reviews.savedPublished" }}
        ownReview={{ rating: 4, comment: "Great crew" } as never}
        stepsBack={false}
        action={noop}
      />,
    );
    expect(screen.getByText("reviews.savedPublished")).toBeTruthy();
    expect(screen.getByText("reviews.yourRating(4)")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Great crew");
  });
});
