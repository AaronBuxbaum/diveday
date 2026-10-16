import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { describe, expect, it, vi } from "vitest";
import {
  type Notification,
  notificationIdempotencyKey,
  notificationIsQueueable,
  notificationSchema,
} from "./kinds";
import { messageFor } from "./render";
import { sesNotificationProvider } from "./ses";

/** The month-end email to the shop's bookkeeper (fifth loop, item 35). */

const BASE = {
  kind: "bookkeeper_month_end",
  shopId: "11111111-1111-4111-8111-111111111111",
  to: "books@ledger.example",
  locale: "en-US",
  shopName: "Blue Mantis <Scuba>",
  month: "2026-09",
  attachments: [
    { fileName: "blue-mantis-2026-09-report.csv", content: "Trip,Revenue\nReef,100.00\n" },
    { fileName: "blue-mantis-2026-09-orders.csv", content: "Order,Total\n" },
  ],
} satisfies Notification;

describe("the bookkeeper_month_end notification", () => {
  it("names the month, the shop and each attached file, and says how to stop it", () => {
    const { subject, text, html } = messageFor(BASE);
    expect(subject).toBe("September 2026 at Blue Mantis <Scuba>: month-end files");
    expect(text).toContain("- blue-mantis-2026-09-report.csv");
    expect(text).toContain("To stop them, ask Blue Mantis <Scuba> to remove the address.");
    expect(html).toContain("Blue Mantis &lt;Scuba&gt;");
    expect(html).not.toContain("<Scuba>");
  });

  it("opens on the month capitalized in Spanish too", () => {
    const { subject } = messageFor({ ...BASE, locale: "es-ES" });
    expect(subject.startsWith("Septiembre")).toBe(true);
  });

  it("is never queued, so the files are never stored, and sends once per shop and month", () => {
    expect(notificationIsQueueable(BASE)).toBe(false);
    expect(notificationIdempotencyKey(BASE)).toBe(
      "bookkeeper-month-end/11111111-1111-4111-8111-111111111111/2026-09",
    );
  });

  it("refuses a file name that could carry a path or another type, and an empty send", () => {
    const parse = (attachments: unknown) =>
      notificationSchema.safeParse({ ...BASE, attachments }).success;
    expect(parse(BASE.attachments)).toBe(true);
    expect(parse([{ fileName: "../etc/passwd.csv", content: "" }])).toBe(false);
    expect(parse([{ fileName: "report.exe", content: "" }])).toBe(false);
    expect(parse([])).toBe(false);
    expect(notificationSchema.safeParse({ ...BASE, month: "2026-9" }).success).toBe(false);
  });

  it("goes out through SES with the files attached as UTF-8 CSV", async () => {
    const client = { send: vi.fn().mockResolvedValue({ MessageId: "ses-books-id" }) };
    const provider = sesNotificationProvider(
      {
        region: "us-east-1",
        from: "DiveDay <noreply@ses.dive.day>",
        accessKeyId: "AKIA_TEST",
        secretAccessKey: "test-secret",
      },
      { client },
    );
    // A reserved test domain is answered without a send; the simulator's is not.
    await provider.send({ ...BASE, to: "delivered+books@dive.day" });
    const command = client.send.mock.calls[0]?.[0] as SendEmailCommand;
    const attachments = command.input.Content?.Simple?.Attachments ?? [];
    expect(attachments.map((file) => file.FileName)).toEqual([
      "blue-mantis-2026-09-report.csv",
      "blue-mantis-2026-09-orders.csv",
    ]);
    expect(attachments[0]?.ContentType).toBe("text/csv; charset=utf-8");
    expect(new TextDecoder().decode(attachments[0]?.RawContent)).toBe(
      "Trip,Revenue\nReef,100.00\n",
    );
  });
});

/** The confirm link and the owners' notices (security review B1 and F1). */
describe("the bookkeeper_confirmation notification", () => {
  const LINK = {
    kind: "bookkeeper_confirmation",
    shopId: "11111111-1111-4111-8111-111111111111",
    to: "books@ledger.example",
    locale: "en-US",
    shopName: "Blue Mantis",
    confirmUrl: "https://diveday.example/confirm-contact/abc",
    expiresAt: new Date("2026-10-27T15:00:00Z"),
    timezone: "America/New_York",
  } satisfies Notification;

  it("carries the link and no files, and says ignoring it sends nothing", () => {
    expect(notificationSchema.safeParse(LINK).success).toBe(true);
    const { subject, text } = messageFor(LINK);
    expect(subject).toBe("Blue Mantis wants to send you its month-end files");
    expect(text).toContain("https://diveday.example/confirm-contact/abc");
    expect(text).toContain("ignore this email and nothing will be sent");
    expect(notificationIsQueueable(LINK)).toBe(false);
  });
});

describe("the bookkeeper_notice notification", () => {
  const NOTICE = {
    kind: "bookkeeper_notice",
    shopId: "11111111-1111-4111-8111-111111111111",
    personId: "22222222-2222-4222-8222-222222222222",
    to: "dana@shop.example",
    locale: "en-US",
    recipientName: "Dana Reyes",
    shopName: "Blue Mantis",
    reportsUrl: "https://diveday.example/shop/blue-mantis/reports#bookkeeper",
    event: "set",
    email: "books@ledger.example",
    actorName: "Sal <Moretti>",
    at: new Date("2026-10-20T15:00:00Z"),
  } satisfies Notification;

  it("names who set which address, escaped, with the way to Reports", () => {
    const { subject, text, html } = messageFor(NOTICE);
    expect(subject).toBe("Blue Mantis: month-end files will go to books@ledger.example");
    expect(text).toContain("Sal <Moretti> set books@ledger.example as the bookkeeper’s email.");
    expect(html).toContain("Sal &lt;Moretti&gt;");
    expect(notificationIsQueueable(NOTICE)).toBe(false);
  });

  it("says where each month went, in one line", () => {
    const { subject, text } = messageFor({
      ...NOTICE,
      event: "sent",
      actorName: undefined,
      month: "2026-09",
    });
    expect(subject).toBe("Blue Mantis: September 2026 files sent to books@ledger.example");
    expect(text).toContain("Month-end files for September 2026 sent to books@ledger.example.");
  });

  it("says when it was turned off, in Spanish too", () => {
    const off = { ...NOTICE, event: "cleared" as const, email: undefined };
    expect(messageFor(off).text).toContain("removed the bookkeeper’s email");
    expect(messageFor({ ...off, locale: "es-ES" }).subject).toBe(
      "Blue Mantis: archivos de fin de mes desactivados",
    );
  });
});
