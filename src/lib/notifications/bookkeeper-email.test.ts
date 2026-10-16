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
