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
 * **The refund amount stands level with "Refund payment"**, the one 48px
 * control beside an `md` danger button (K-10). Its width is a wrapper's, not a
 * `w-32` beside the control's own `w-full`, because two width utilities
 * resolve by stylesheet order rather than class order.
 */
describe("the order's refund row", () => {
  it("sizes the amount box on a wrapper, beside an md Refund button", () => {
    expect(REFUND_FORM).toMatch(/name="amountMajor"/);
    expect(REFUND_FORM).toMatch(/\$\{controlClass\} tabular-nums/);
    expect(REFUND_FORM).not.toMatch(/controlClass[^`]*\bw-32\b/);
    expect(REFUND_FORM).toMatch(/buttonClass\(\{ variant: "danger" \}\)/);
  });
});
