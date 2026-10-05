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

/** Whether an address goes to the SES mailbox simulator, whatever its outcome or label. */
export function isSimulatorEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  return at > 0 && email.slice(at + 1).toLowerCase() === SES_SIMULATOR_DOMAIN;
}
