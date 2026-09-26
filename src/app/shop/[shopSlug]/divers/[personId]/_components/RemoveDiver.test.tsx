// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RemoveDiver } from "./RemoveDiver";
import type { DiverProfile } from "./shared";

// The confirm posts a server action, and with it the whole Next server
// runtime. This suite is about how the disclosure is drawn.
vi.mock("../actions", () => ({ deletePersonAction: vi.fn() }));

afterEach(cleanup);

/**
 * **The record's quiet foot is one size** (pixel-craft class 12). "Download
 * record" beside it is the default `md` — 48px with a 16px label — and the
 * "Remove diver" confirm the disclosure opens onto is `md` too, while the
 * disclosure itself was `sm`: 44px and 14px, centred on the row, 2px short
 * of the button beside it at each edge. The size follows the surface, and
 * the foot is a page row, not a ledger row.
 */
describe("the remove-diver disclosure", () => {
  it("stands at the size of the buttons beside and under it", () => {
    const { container } = render(
      <RemoveDiver
        diver={{ person: { fullName: "Morgan Vale" } } as unknown as DiverProfile}
        shopSlug="blue-mantis"
        personId="person-1"
        t={staffTranslator("en-US")}
      />,
    );
    const summary = container.querySelector("summary");
    expect(summary).toHaveTextContent("Morgan Vale");
    expect(summary).toHaveClass("min-h-12", "text-base");
    expect(summary).not.toHaveClass("text-sm");
  });
});
