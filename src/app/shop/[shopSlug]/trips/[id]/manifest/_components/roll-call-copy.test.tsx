// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "./diver-roll-call-test-fixtures";
import { rollCallCopies } from "./roll-call-copy";

afterEach(cleanup);

describe("rollCallCopies", () => {
  it("links a diver's still-blocked refusal to that diver's own Guests anchor", () => {
    const { rollCallButtonCopy } = rollCallCopies(t, "blue-mantis", "trip-1");
    render(<p>{rollCallButtonCopy("bk-7").blockedMessage}</p>);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1#booking-bk-7",
    );
  });

  it("gives the crew the plain refusal for both, since crew have no readiness", () => {
    const { crewRollCallButtonCopy } = rollCallCopies(t, "blue-mantis", "trip-1");
    expect(crewRollCallButtonCopy.blockedMessage).toBe(crewRollCallButtonCopy.errorRefusal);
  });
});
