import { describe, expect, it } from "vitest";
import { afterNotices } from "./after-notices";

describe("afterNotices", () => {
  it("names each form's outcome by its own key", () => {
    const notices = afterNotices({ review: "published", photo: "limit", tip: "paid" }, null, null);
    expect(notices.reviewNotice).toEqual({ tone: "success", key: "reviews.savedPublished" });
    expect(notices.photoNotice).toEqual({ tone: "danger", key: "recap.photoLimit" });
    expect(notices.tipNotice).toEqual({ tone: "success", key: "recap.tipThanksNotice" });
  });

  it("never walks the prototype on an attacker's param", () => {
    const notices = afterNotices({ review: "toString", photo: "constructor" }, null, null);
    expect(notices.reviewNotice).toBeUndefined();
    expect(notices.photoNotice).toBeUndefined();
  });

  it("offers the public review link only right after a review went through, at any rating", () => {
    const url = "https://g.page/r/example";
    const own = { rating: 1, comment: null } as never;
    expect(afterNotices({ review: "published" }, own, url).externalReviewUrl).toBe(url);
    expect(afterNotices({ review: "pending" }, own, url).externalReviewUrl).toBe(url);
    expect(afterNotices({}, own, url).externalReviewUrl).toBeNull();
    expect(afterNotices({ review: "published" }, null, url).externalReviewUrl).toBeNull();
  });
});
