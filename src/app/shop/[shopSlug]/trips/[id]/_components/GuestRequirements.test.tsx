// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { GuestRequirements } from "./GuestRequirements";

const t = staffTranslator("en-US");
afterEach(cleanup);
describe("independent guest requirements", () => {
  it("keeps every certification requirement together with one remedy", () => {
    const texts = [
      "Card not verified",
      "Deep requirement outstanding",
      "Nitrox requirement outstanding",
    ];
    render(
      <GuestRequirements
        t={t}
        payment={null}
        contact={null}
        blockers={texts.map((text) => ({ text, blocker: { code: "certification_missing" } }))}
        lines={texts.map((text, index) => ({
          key: text,
          text,
          tone: "danger",
          actions: index === 0 ? <a href="/cards">Review cards</a> : undefined,
        }))}
      />,
    );
    const task = screen.getByRole("region", { name: "Certification" });
    for (const text of texts) expect(within(task).getByText(text)).toBeVisible();
    expect(within(task).getAllByRole("link", { name: "Review cards" })).toHaveLength(1);
  });
  it("puts the real payment control on the debt and omits the duplicate amber state", () => {
    render(
      <GuestRequirements
        t={t}
        contact={null}
        payment={<button type="button">Record payment</button>}
        blockers={[{ text: "Balance is outstanding", blocker: { code: "payment_due" } }]}
        lines={[
          { key: "Balance is outstanding", text: "Balance is outstanding", tone: "danger" },
          { key: "payment", text: "Not paid yet", tone: "warning" },
        ]}
      />,
    );
    const task = screen.getByRole("region", { name: "Payment" });
    expect(within(task).getByText("Balance is outstanding")).toBeVisible();
    expect(within(task).getByRole("button", { name: "Record payment" })).toBeVisible();
    expect(screen.queryByText("Not paid yet")).toBeNull();
  });
});
