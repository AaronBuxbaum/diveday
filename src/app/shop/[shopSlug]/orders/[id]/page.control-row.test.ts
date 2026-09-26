import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: the order page is a Server Component behind the staff
 * session, so this pins the source that decides the geometry; nothing here
 * measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const REFUND_FORM = SOURCE.slice(
  SOURCE.indexOf("action={refundAction}"),
  SOURCE.indexOf("</form>", SOURCE.indexOf("action={refundAction}")),
);

/**
 * **The refund amount stands level with "Refund payment".** The box was the
 * stacked field's 44px beside the `md` danger button's 48px, in a row aligned
 * `items-end`, so the button stood 4px above the box's top edge — the K-10
 * mismatch this branch fixed at three other rows, on a line it had already
 * edited for K-45. A row with a text control in it is an `md` row. Its width
 * is a wrapper's, not a `w-32` beside the control's own `w-full`, because two
 * width utilities resolve by stylesheet order rather than class order.
 */
describe("the order's refund row", () => {
  it("draws the amount box at md, the size of the Refund button beside it", () => {
    expect(REFUND_FORM).toMatch(/name="amountMajor"/);
    expect(REFUND_FORM).toMatch(/\$\{controlClassFor\("md"\)\} tabular-nums/);
    expect(REFUND_FORM).not.toMatch(/\$\{controlClass\}/);
    expect(REFUND_FORM).not.toMatch(/controlClass[^`]*\bw-32\b/);
    expect(REFUND_FORM).toMatch(/buttonClass\(\{ variant: "danger" \}\)/);
  });
});
