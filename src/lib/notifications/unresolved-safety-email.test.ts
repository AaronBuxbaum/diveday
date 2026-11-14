import { describe, expect, it } from "vitest";
import { notificationIdempotencyKey, notificationIsQueueable, notificationSchema } from "./kinds";
import { messageFor } from "./render";
import { unresolvedSafetyReviewEmail } from "./unresolved-safety-email";

const input = {
  locale: "en-US" as const,
  recipientName: "Ana Ruiz",
  shopName: "Blue <Mantis>",
  tripTitle: "Reef <trip>",
  reviewUrl: "https://diveday.example/shop/blue/trips/id/manifest",
};

describe("unresolvedSafetyReviewEmail", () => {
  it("asks for review without claiming a person or meeting, and escapes the trip", () => {
    const message = unresolvedSafetyReviewEmail(input);
    expect(message.text).toContain("A safety observation for Reef <trip> needs review");
    expect(message.text).toContain("may not identify the person or meeting");
    expect(message.text).toContain(input.reviewUrl);
    expect(message.text).not.toMatch(/missing diver|after dive|\d+ people|all.clear/i);
    expect(message.html).toContain("Reef &lt;trip&gt;");
    expect(message.html).not.toContain("Reef <trip>");
  });

  it("renders the same uncertainty in Spanish", () => {
    const message = unresolvedSafetyReviewEmail({ ...input, locale: "es-ES" });
    expect(message.text).toContain("necesita revisión");
    expect(message.text).toContain("puede no identificar");
    expect(message.text).toContain(input.reviewUrl);
  });

  it("uses a separate generation and recipient key without the generic retry queue", () => {
    const notification = notificationSchema.parse({
      ...input,
      kind: "unresolved_safety_evidence",
      shopId: "2d14a07e-7a85-4849-b1d7-74fc8d998307",
      tripId: "3d14a07e-7a85-4849-b1d7-74fc8d998307",
      personId: "4d14a07e-7a85-4849-b1d7-74fc8d998307",
      generationId: "5d14a07e-7a85-4849-b1d7-74fc8d998307",
      to: "owner@example.test",
    });
    if (notification.kind !== "unresolved_safety_evidence") throw new Error("wrong kind");
    expect(notificationIsQueueable(notification)).toBe(false);
    expect(notificationIdempotencyKey(notification)).toBe(
      `unresolved-safety-evidence/${notification.generationId}/${notification.personId}`,
    );
    expect(messageFor(notification).text).toContain("needs review");
  });
});
