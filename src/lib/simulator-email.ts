/**
 * Addresses for made-up people: the divers, guardians and shop desks the demo
 * seed invents.
 *
 * They used to sit under `example.com`, which nothing can deliver to, so the
 * provider refused every message to them before a request was made
 * (`reservedTestRecipientDelivery`). A demo booking then showed a failed
 * confirmation, and nobody could watch a seeded diver's mail go out.
 *
 * The SES mailbox simulator takes the mail instead. A send to
 * `success@simulator.amazonses.com` is accepted and delivered like real mail,
 * but it is left out of the account's bounce and complaint rates, so a demo or
 * a test run can never hurt the reputation real divers' mail depends on. It is
 * also one of the few recipients the SES sandbox accepts without verification.
 *
 * Each person needs their own address, because `people_shop_email_unique`
 * holds one row per address per shop. The simulator accepts a `+label` on every
 * address and treats it the same as the bare one, so the label carries the
 * person: `success+priya.sharma@simulator.amazonses.com`.
 *
 * **What staff read is a human address; what SES receives is the simulator**
 * (UX audit 2026-10-07, item 4). A roster, an inbox and a mailto that all
 * said `success+priya.sharma@simulator.amazonses.com` made the demo shop look
 * like a test harness. So the seed stores `priya.sharma@mail.example`
 * ({@link demoEmail}), and the SES provider maps that one domain onto the
 * simulator at the moment of sending ({@link deliveryAddressFor}). `.example`
 * is reserved (RFC 2606) and can never reach a real inbox, so the mapping
 * cannot redirect anybody's real mail.
 *
 * **Only for a demo shop** (`shops.is_demo`). On a real shop a diver who types
 * `me@mail.example` has typed an address nobody reads, and staff must see that
 * send refused (`invalid_test_recipient`), not reported delivered to a
 * simulator. So the mapping runs only when the send says it comes from a demo
 * shop — `NotificationSender.demoShop`, resolved from the shop row at send
 * time in `src/db/notifications.ts` — and every other `mail.example` address
 * is refused at the provider boundary as before.
 *
 * Staff demo sign-ins are not here. They stay under `demo.invalid`
 * (`src/lib/demo-identity.ts`), because that domain is half of the demo
 * sign-in bypass and must never be an address anyone can receive mail at.
 */

export const SES_SIMULATOR_DOMAIN = "simulator.amazonses.com";

/** What the simulator does with the message. Only `success` is safe for seed data. */
export type SimulatorOutcome = "success" | "bounce" | "complaint" | "ooto" | "suppressionlist";

/** `success+<label>@simulator.amazonses.com`, the label lowercased to `[a-z0-9.-]`. */
export function simulatorEmail(label: string, outcome: SimulatorOutcome = "success"): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  if (!slug) throw new Error("simulatorEmail: the label has no letters or digits");
  return `${outcome}+${slug}@${SES_SIMULATOR_DOMAIN}`;
}

/** The reserved domain seeded people's addresses live under, as staff read them. */
export const DEMO_MAIL_DOMAIN = "mail.example";

/** `priya.sharma@mail.example`: a seeded person's address as staff read it. */
export function demoEmail(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  if (!slug) throw new Error("demoEmail: the label has no letters or digits");
  return `${slug}@${DEMO_MAIL_DOMAIN}`;
}

/**
 * Where a message to `to` is actually sent. On a demo shop, a seeded person's
 * address ({@link DEMO_MAIL_DOMAIN}) goes to the SES mailbox simulator's
 * success address under the same label; every other address, and every
 * address on a shop that is not a demo, is sent as written.
 */
export function deliveryAddressFor(to: string, from: { demoShop: boolean }): string {
  if (!from.demoShop) return to;
  const at = to.lastIndexOf("@");
  if (at <= 0) return to;
  const domain = to
    .slice(at + 1)
    .toLowerCase()
    .replace(/\.$/, "");
  if (domain !== DEMO_MAIL_DOMAIN) return to;
  return simulatorEmail(to.slice(0, at));
}
