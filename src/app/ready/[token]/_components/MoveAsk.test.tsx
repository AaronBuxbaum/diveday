// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { formatDateTimeTz } from "@/lib/format";
import { MoveAsk } from "./MoveAsk";

afterEach(cleanup);

const sentAt = new Date("2026-07-21T13:30:00.000Z");
const timeZone = "America/New_York";

describe("a pending move request receipt", () => {
  it.each(["en-US", "es-ES"] as const)(
    "shows the standing note, shop timezone and next action in %s",
    (locale) => {
      const t = diverTranslator(locale);
      const { container } = render(
        <MoveAsk
          state={{ note: "Any Saturday in August", sentAt }}
          tripId="trip-1"
          shopName="Blue Mantis"
          shopPhone={null}
          locale={locale}
          timeZone={timeZone}
          action={async () => {}}
          t={t}
        />,
      );
      expect(screen.getByText("Any Saturday in August")).toBeInTheDocument();
      expect(
        screen.getByText(t("ready.moveAsk.asked", { shop: "Blue Mantis" })),
      ).toBeInTheDocument();
      const receiptTime = container.querySelector("time");
      expect(receiptTime).toHaveAttribute("datetime", sentAt.toISOString());
      // Keep the formatter's nonbreaking spaces exact rather than normalizing
      // the rendered date and timezone into a different string for the query.
      expect(receiptTime?.textContent).toBe(
        t("ready.moveAsk.sentAt", { when: formatDateTimeTz(sentAt, locale, timeZone) }),
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByText(t("ready.moveAsk.bookingUnchanged"))).toBeInTheDocument();
    },
  );

  it("keeps the receipt when the optional note was empty", () => {
    const t = diverTranslator("en-US");
    const { container } = render(
      <MoveAsk
        state={{ note: "", sentAt }}
        tripId="trip-1"
        shopName="Blue Mantis"
        shopPhone={null}
        locale="en-US"
        timeZone={timeZone}
        action={async () => {}}
        t={t}
      />,
    );
    expect(container.querySelector("time")).toHaveAttribute("datetime", sentAt.toISOString());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders the diver's note as text", () => {
    const t = diverTranslator("en-US");
    const note = "<script>private note</script>";
    const { container } = render(
      <MoveAsk
        state={{ note, sentAt }}
        tripId="trip-1"
        shopName="Blue Mantis"
        shopPhone={null}
        locale="en-US"
        timeZone={timeZone}
        action={async () => {}}
        t={t}
      />,
    );
    expect(screen.getByText(note)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("posts the displayed departure with the original form", () => {
    const t = diverTranslator("en-US");
    const tripId = "0f2a9c1e-2222-4222-8333-444444444444";
    const { container } = render(
      <MoveAsk
        state="open"
        tripId={tripId}
        shopName="Blue Mantis"
        shopPhone={null}
        locale="en-US"
        timeZone={timeZone}
        action={async () => {}}
        t={t}
      />,
    );
    expect(container.querySelector('input[name="tripId"]')).toHaveValue(tripId);
    expect(screen.getByRole("button", { name: t("ready.moveAsk.action") })).toBeInTheDocument();
  });
});
