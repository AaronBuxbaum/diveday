// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { MergeDiver } from "./MergeDiver";

vi.mock("../actions", () => ({
  mergeDiverAction: Object.assign(() => {}, { bind: () => () => {} }),
}));

afterEach(cleanup);

const candidates = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Maya Rivera",
    email: "maya@example.test",
    phone: "+1 305 555 0142",
    reasons: ["same_name" as const],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    fullName: "Maya Rivera",
    email: null,
    phone: "+1 305 555 0142",
    reasons: ["same_phone" as const],
  },
];

/**
 * The panel used to head its list with the record being viewed, checked by
 * default -- and the form posts one id which the action always merges the
 * route's diver *into*, so that option posted `survivorId === personId` and was
 * refused outright. An owner who left the default alone was told to choose one
 * of the duplicates, which is what they had done.
 */
describe("the merge-diver panel", () => {
  it("offers only the duplicates, so every choice is a merge that can run", () => {
    render(
      <MergeDiver
        candidates={candidates}
        shopSlug="blue-mantis"
        personId="33333333-3333-4333-8333-333333333333"
        t={staffTranslator("en-US")}
      />,
    );

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)).toEqual(candidates.map((c) => c.id));
    expect(radios.map((radio) => radio.value)).not.toContain(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("pre-selects a duplicate rather than an option that cannot run", () => {
    render(
      <MergeDiver
        candidates={candidates}
        shopSlug="blue-mantis"
        personId="33333333-3333-4333-8333-333333333333"
        t={staffTranslator("en-US")}
      />,
    );

    const checked = (screen.getAllByRole("radio") as HTMLInputElement[]).filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]?.value).toBe(candidates[0]?.id);
  });

  it("renders nothing to merge when the roster found no duplicates", () => {
    render(
      <MergeDiver
        candidates={[]}
        shopSlug="blue-mantis"
        personId="33333333-3333-4333-8333-333333333333"
        t={staffTranslator("en-US")}
      />,
    );
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});
