// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  countUnhandledInboundEmails,
  listInboundEmails,
  MAX_INBOUND_BODY_LENGTH,
  MAX_INBOUND_RECIPIENTS,
  recordInboundEmail,
  routeInboundEmail,
  setInboundEmailHandled,
  truncateInboundBody,
} from "./inbound-emails";
import {
  addPlatformMailboxMember,
  archivePlatformMailbox,
  createPlatformMailbox,
  loadPlatformAccess,
  NO_PLATFORM_ACCESS,
} from "./platform-mailboxes";
import { people } from "./schema";

const ADMIN_ENV = { PLATFORM_ADMIN_EMAILS: "dana@bluemantis.example" };

const baseMessage = {
  providerEmailId: "em_in_1",
  from: "Priya Raman <priya@example.com>",
  recipients: ["hello@dive.day"],
  subject: "Switching from DiveAdmin",
  textBody: "How much of our diver list comes across?",
  hasAttachments: false,
  receivedAt: new Date("2026-07-24T18:00:00.000Z"),
};

/** A database with two live role addresses and no platform mail yet. */
async function seededMailboxes() {
  const { db } = await seededShopContext();
  const hello = await createPlatformMailbox(db, { address: "hello@dive.day", label: "General" });
  const legal = await createPlatformMailbox(db, { address: "legal@dive.day", label: "Legal" });
  if (!hello.ok || !legal.ok) throw new Error("mailbox not created");
  return { db, helloId: hello.id, legalId: legal.id };
}

type TestDb = Awaited<ReturnType<typeof seededShopContext>>["db"];

async function personIdByEmail(db: TestDb, email: string): Promise<string> {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.email, email))
    .limit(1);
  if (!person) throw new Error(`no person with email ${email}`);
  return person.id;
}

describe("routeInboundEmail", () => {
  it("files a message under the mailbox for the address it was sent to", async () => {
    const { db, legalId } = await seededMailboxes();
    await expect(routeInboundEmail(db, ["Legal <Legal@Dive.Day>"])).resolves.toEqual({
      mailboxId: legalId,
      toEmail: "legal@dive.day",
    });
  });

  it("picks the claimed address out of a message sent to several", async () => {
    const { db, helloId } = await seededMailboxes();
    await expect(
      routeInboundEmail(db, ["someone@elsewhere.example", "hello@dive.day"]),
    ).resolves.toEqual({ mailboxId: helloId, toEmail: "hello@dive.day" });
  });

  it("leaves mail to an unclaimed address unrouted but still names what was addressed", async () => {
    const { db } = await seededMailboxes();
    await expect(routeInboundEmail(db, ["hllo@dive.day"])).resolves.toEqual({
      mailboxId: null,
      toEmail: "hllo@dive.day",
    });
  });

  it("stops routing to a retired address", async () => {
    const { db, legalId } = await seededMailboxes();
    await archivePlatformMailbox(db, legalId, new Date("2026-07-24T12:00:00.000Z"));
    await expect(routeInboundEmail(db, ["legal@dive.day"])).resolves.toMatchObject({
      mailboxId: null,
    });
  });

  it("survives a message whose recipients are all unparseable", async () => {
    const { db } = await seededMailboxes();
    await expect(routeInboundEmail(db, ["not-an-address"])).resolves.toEqual({
      mailboxId: null,
      toEmail: "",
    });
  });
});

describe("recordInboundEmail", () => {
  it("stores the sender's name and address separately", async () => {
    const { db, helloId } = await seededMailboxes();
    await recordInboundEmail(db, {
      ...baseMessage,
      mailboxId: helloId,
      toEmail: "hello@dive.day",
    });

    const admin = { isAdmin: true, mailboxIds: [] };
    await expect(listInboundEmails(db, admin)).resolves.toMatchObject([
      {
        fromEmail: "priya@example.com",
        fromName: "Priya Raman",
        toEmail: "hello@dive.day",
        mailboxAddress: "hello@dive.day",
        textBody: "How much of our diver list comes across?",
      },
    ]);
  });

  it("is idempotent on the provider's email id, so a redelivered webhook adds nothing", async () => {
    const { db, helloId } = await seededMailboxes();
    const message = { ...baseMessage, mailboxId: helloId, toEmail: "hello@dive.day" };

    const first = await recordInboundEmail(db, message);
    const second = await recordInboundEmail(db, message);

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ id: first.id, duplicate: true });
    await expect(listInboundEmails(db, { isAdmin: true, mailboxIds: [] })).resolves.toHaveLength(1);
  });
});

describe("who may read what", () => {
  async function seededMail() {
    const { db, helloId, legalId } = await seededMailboxes();
    await recordInboundEmail(db, {
      ...baseMessage,
      mailboxId: helloId,
      toEmail: "hello@dive.day",
    });
    await recordInboundEmail(db, {
      ...baseMessage,
      providerEmailId: "em_in_2",
      subject: "Waiver retention terms",
      textBody: "How long are signatures kept?",
      mailboxId: legalId,
      toEmail: "legal@dive.day",
    });
    await recordInboundEmail(db, {
      ...baseMessage,
      providerEmailId: "em_in_3",
      subject: "Weekly digest",
      textBody: "This week in dive retail…",
      mailboxId: null,
      toEmail: "hllo@dive.day",
    });
    return { db, helloId, legalId };
  }

  it("shows a member only the mailboxes they belong to", async () => {
    const { db, helloId } = await seededMail();
    const messages = await listInboundEmails(db, { isAdmin: false, mailboxIds: [helloId] });
    expect(messages.map((m) => m.toEmail)).toEqual(["hello@dive.day"]);
  });

  it("shows an operator everything, including mail no mailbox claims", async () => {
    const { db } = await seededMail();
    const messages = await listInboundEmails(db, { isAdmin: true, mailboxIds: [] });
    expect(messages.map((m) => m.toEmail).sort()).toEqual([
      "hello@dive.day",
      "hllo@dive.day",
      "legal@dive.day",
    ]);
  });

  it("shows nothing at all to a person with neither membership nor operator access", async () => {
    const { db } = await seededMail();
    await expect(listInboundEmails(db, NO_PLATFORM_ACCESS)).resolves.toEqual([]);
    await expect(countUnhandledInboundEmails(db, NO_PLATFORM_ACCESS)).resolves.toBe(0);
  });

  it("refuses to mark a message handled from a mailbox the person can't read", async () => {
    const { db, helloId, legalId } = await seededMail();
    const [legalMessage] = await listInboundEmails(db, { isAdmin: false, mailboxIds: [legalId] });
    const staffId = await personIdByEmail(db, "dana@bluemantis.example");

    await expect(
      setInboundEmailHandled(db, {
        access: { isAdmin: false, mailboxIds: [helloId] },
        inboundEmailId: legalMessage.id,
        handled: true,
        byPersonId: staffId,
      }),
    ).resolves.toBe(false);
    // Still sitting unread in the mailbox that owns it.
    await expect(
      countUnhandledInboundEmails(db, { isAdmin: false, mailboxIds: [legalId] }),
    ).resolves.toBe(1);
  });

  it("clears a message a member owns and puts it back on request", async () => {
    const { db, helloId } = await seededMail();
    const access = { isAdmin: false, mailboxIds: [helloId] };
    const [message] = await listInboundEmails(db, access);
    const staffId = await personIdByEmail(db, "dana@bluemantis.example");

    await expect(
      setInboundEmailHandled(db, {
        access,
        inboundEmailId: message.id,
        handled: true,
        byPersonId: staffId,
      }),
    ).resolves.toBe(true);
    await expect(countUnhandledInboundEmails(db, access)).resolves.toBe(0);
    await expect(listInboundEmails(db, access)).resolves.toEqual([]);
    await expect(listInboundEmails(db, access, { includeHandled: true })).resolves.toHaveLength(1);

    await setInboundEmailHandled(db, {
      access,
      inboundEmailId: message.id,
      handled: false,
      byPersonId: staffId,
    });
    await expect(countUnhandledInboundEmails(db, access)).resolves.toBe(1);
  });
});

describe("loadPlatformAccess", () => {
  it("grants operator access from the deploy-time allowlist", async () => {
    const { db } = await seededMailboxes();
    const staffId = await personIdByEmail(db, "dana@bluemantis.example");
    await expect(loadPlatformAccess(db, staffId, ADMIN_ENV)).resolves.toMatchObject({
      isAdmin: true,
    });
  });

  it("grants a non-operator exactly their memberships", async () => {
    const { db, legalId } = await seededMailboxes();
    const staffId = await personIdByEmail(db, "marcus@bluemantis.example");
    await addPlatformMailboxMember(db, {
      mailboxId: legalId,
      email: "marcus@bluemantis.example",
    });

    await expect(loadPlatformAccess(db, staffId, ADMIN_ENV)).resolves.toEqual({
      isAdmin: false,
      mailboxIds: [legalId],
    });
  });

  it("gives nothing away when the allowlist is unset", async () => {
    const { db } = await seededMailboxes();
    const staffId = await personIdByEmail(db, "dana@bluemantis.example");
    await expect(loadPlatformAccess(db, staffId, {})).resolves.toEqual(NO_PLATFORM_ACCESS);
  });

  it("drops a membership when its mailbox is retired", async () => {
    const { db, legalId } = await seededMailboxes();
    const staffId = await personIdByEmail(db, "marcus@bluemantis.example");
    await addPlatformMailboxMember(db, { mailboxId: legalId, email: "marcus@bluemantis.example" });
    await archivePlatformMailbox(db, legalId, new Date("2026-07-24T12:00:00.000Z"));

    await expect(loadPlatformAccess(db, staffId, ADMIN_ENV)).resolves.toEqual(NO_PLATFORM_ACCESS);
  });
});

describe("bounds on the rest of the message", () => {
  it("stores a runaway subject and sender bounded, not just the body", async () => {
    const { db, helloId } = await seededMailboxes();
    await recordInboundEmail(db, {
      ...baseMessage,
      from: `${"n".repeat(5_000)} <${"a".repeat(5_000)}@example.com>`,
      subject: "s".repeat(5_000),
      mailboxId: helloId,
      toEmail: "hello@dive.day",
    });

    const [message] = await listInboundEmails(db, { isAdmin: true, mailboxIds: [] });
    expect(message.subject?.length).toBeLessThanOrEqual(500);
    expect(message.fromEmail.length).toBeLessThanOrEqual(320);
    expect(message.fromName?.length).toBeLessThanOrEqual(320);
  });

  it("stops walking recipients well before an uncapped cc list becomes N queries", async () => {
    const { db, helloId } = await seededMailboxes();
    const buried = [
      ...Array.from({ length: 200 }, (_, i) => `person${i}@elsewhere.example`),
      "hello@dive.day",
    ];

    // The claimed address is past the cap, so the message files as unrouted
    // rather than costing 201 lookups to find.
    await expect(routeInboundEmail(db, buried)).resolves.toMatchObject({ mailboxId: null });
    expect(MAX_INBOUND_RECIPIENTS).toBeLessThan(buried.length);
    expect(helloId).toBeTruthy();
  });
});

describe("truncateInboundBody", () => {
  it("leaves an ordinary message alone", () => {
    expect(truncateInboundBody("short")).toBe("short");
  });

  it("bounds a runaway body rather than storing it whole", () => {
    const truncated = truncateInboundBody("x".repeat(MAX_INBOUND_BODY_LENGTH + 500));
    expect(truncated.length).toBeLessThan(MAX_INBOUND_BODY_LENGTH + 100);
    expect(truncated.endsWith("[truncated]")).toBe(true);
  });
});
