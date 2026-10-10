// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { DiverStatusLedger } from "./DiverStatusLedger";
import { RestoreDiver } from "./RestoreDiver";

// Restoring posts a server action, and with it the whole Next server runtime.
// This suite is about where the panel stands.
vi.mock("../record-actions", () => ({ restorePersonAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");
const topGap = (element: Element | null) =>
  [...(element?.classList ?? [])].filter((token) => /^m[ty]-/.test(token));

/**
 * **The deleted panel is the record's first block, and it stands where the
 * first block stands** (pixel-craft class 4). Every other record opens 32px
 * under the acts row — the status ledger's `mt-8` — and this panel took
 * `mt-6`, 24px, while the gap from it down to the ledger was already 32.
 */
describe("the deleted diver's panel", () => {
  it("sits under the acts row at the status ledger's own gap", () => {
    render(<RestoreDiver shopSlug="blue-mantis" personId="person-1" canRestore t={t} />);
    const panel = screen.getByRole("region", { name: "This diver is deleted" });
    cleanup();
    const { container } = render(
      <DiverStatusLedger
        rows={[{ kind: "waiver", tone: "danger", sentence: { key: "divers.status.waiverHeld" } }]}
        t={t}
        locale="en-US"
        timezone="America/Cancun"
        shopSlug="blue-mantis"
      />,
    );
    const ledger = container.querySelector("ul");
    expect(topGap(ledger)).toEqual(["mt-8"]);
    expect(topGap(panel)).toEqual(topGap(ledger));
  });
});
