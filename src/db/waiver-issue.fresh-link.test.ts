import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { people, waiverRecords } from "./schema";
import { emailFreshWaiverLink, issueAndDeliverPersonWaiver } from "./waiver-issue";
import { completeWaiver, issueWaiverRequest, waiverLinkDoor } from "./waivers";
import { shopStaffer } from "./waivers-test-fixtures";

const { sesSend } = vi.hoisted(() => ({ sesSend: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sesv2")>();
  return {
    ...actual,
    SESv2Client: vi.fn().mockImplementation(function SESv2Client() {
      return { send: sesSend };
    }),
  };
});

const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => {
  vi.unstubAllEnvs();
  sesSend.mockReset();
});

describe("emailFreshWaiverLink", () => {
  /** A diver with no seat, a release link to their release, and the instant it is dead. */
  async function expiredLink(email: string | null = "delivered@dive.day") {
    const { db, shop } = ctx;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Nora Quinn", email })
      .returning();
    if (!person) throw new Error("person insert failed");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id });
    if (!issued.ok || issued.key.kind !== "release") throw new Error("expected a release link");
    const after = new Date(issued.key.expiresAt.getTime() + 1);
    return { db, shop, person, recordId: issued.recordId, token: issued.key.token, after };
  }

  function configureEmail() {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "ses-id" });
    return sesSend;
  }

  it("mails a replacement to the address on file and never hands one back", async () => {
    const send = configureEmail();
    const { db, token, after } = await expiredLink();

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("sent");
    expect(send).toHaveBeenCalledOnce();
    // The whole point of the flow: a stale bearer URL triggers a delivery to
    // its owner and nothing more. Anything token-shaped in the return value
    // would hand fresh access to whoever is holding the dead link.
    const command = send.mock.calls[0]?.[0] as SendEmailCommand;
    expect(command.input.Destination?.ToAddresses).toEqual(["delivered@dive.day"]);
    const html = String(command.input.Content?.Simple?.Body?.Html?.Data);
    expect(html).toMatch(/\/waivers\/[A-Za-z0-9_-]+/);
    expect(html).not.toContain(token);
  });

  it("stays usable from the same dead URL after the first send", async () => {
    configureEmail();
    const { db, token, after } = await expiredLink();

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("sent");
    expect(await waiverLinkDoor(db, token, { now: after })).toBeNull();
    // While the replacement is live, a second tap reports that rather than
    // issuing over it and killing the link the diver is using.
    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("current_link_live");
    // Once the replacement has died too, the same dead URL sends another.
    const afterReplacement = new Date(after.getTime() + 7 * 24 * 60 * 60 * 1000 + 1);
    await expect(emailFreshWaiverLink(db, token, afterReplacement)).resolves.toBe("sent");
  });

  it("refuses for a person the shop removed", async () => {
    configureEmail();
    const { db, person, token, after } = await expiredLink();
    await db.update(people).set({ deletedAt: after }).where(eq(people.id, person.id));

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("unavailable");
  });

  it("reports a signature already on file instead of mailing a pointless link", async () => {
    configureEmail();
    const { db, shop, person, recordId, token, after } = await expiredLink();
    // The stale link's release was replaced and the replacement signed: the
    // diver signed something the stale URL no longer points at.
    await db
      .update(waiverRecords)
      .set({ supersededAt: after })
      .where(eq(waiverRecords.id, recordId));
    const fresh = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: after,
    });
    if (!fresh.ok) throw new Error(`issue failed: ${fresh.reason}`);
    await completeWaiver(db, fresh.key, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      now: after,
    });

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("already_signed");
  });

  it("says so plainly when there is no address to send to", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, token, after } = await expiredLink(null);

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("no_email");
  });

  it("never claims mail is on its way when nothing left the building", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "");
    vi.stubEnv("SES_FROM_EMAIL", "");
    const { db, token, after } = await expiredLink();

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("failed");
  });

  it("refuses a live link, a counter link and a token that matches nothing", async () => {
    const send = configureEmail();
    const { db, shop, person, token, after } = await expiredLink();
    await expect(emailFreshWaiverLink(db, token)).resolves.toBe("unavailable");
    await expect(emailFreshWaiverLink(db, `${token}tampered`, after)).resolves.toBe("unavailable");
    const copied = await issueAndDeliverPersonWaiver(db, shop.id, person.id, {
      channel: "link",
      actorPersonId: await shopStaffer(db, shop.id),
    });
    if (!copied.ok || !copied.token) throw new Error("copy link refused");
    const dead = new Date(nowDate().getTime() + 31 * 60 * 1000);
    await expect(emailFreshWaiverLink(db, copied.token, dead)).resolves.toBe("unavailable");
    expect(send).not.toHaveBeenCalled();
  });
});
