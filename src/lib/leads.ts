/**
 * **Who wants in** (ADR 20261017-one-lead-with-a-scope): the framework-free half
 * of the `leads` table. A lead is a person who asked for a seat; it reserves
 * nothing and never reaches a manifest. Staff never see the word "lead".
 */

/** What the lead asked for. Mirrors the `lead_scope` enum (`src/db/schema/leads.ts`). */
export const LEAD_SCOPES = ["departure", "date", "anytime"] as const;
export type LeadScope = (typeof LEAD_SCOPES)[number];

/** `diver`: their form, or staff taking their call. `shop`: cold outreach. */
export const LEAD_ASKED_BY = ["diver", "shop"] as const;
export type LeadAskedBy = (typeof LEAD_ASKED_BY)[number];

/** How a lead ended. Mirrors the `lead_closed_as` enum. */
export type LeadClosedAs = "booked" | "done" | "unsubscribed";

/**
 * The mail class of an offer: **service** reaches the diver whatever their
 * courtesy-email setting and carries no unsubscribe; **commercial** carries the
 * one-click courtesy unsubscribe, takes the 24-hour cold-send window, and is
 * not sent to a person who opted out (H-96; 16 CFR 316.2).
 *
 * One pure function, so the rule is read in one place. Today's three answers
 * (H-145, D-2 option a): a reply to a diver's own date request is service; a
 * wait-list invite, a cold invitation and a rolled or carried lead are
 * commercial, and so is anything that carries a deal.
 *
 * `parentScope` is the scope of the lead this offer row was copied from, when it
 * has one: only a departure row copied from a diver-asked *date* lead is the
 * reply to a request.
 */
export function offerMailClass(input: {
  scope: LeadScope;
  askedBy: LeadAskedBy;
  parentScope?: LeadScope | null;
  carriesDeal?: boolean;
}): "service" | "commercial" {
  if (input.carriesDeal) return "commercial";
  if (input.scope === "departure" && input.askedBy === "diver" && input.parentScope === "date") {
    return "service";
  }
  return "commercial";
}

/**
 * Whether a departure lead is on the wait list as staff read it: the diver
 * asked for this boat. A cold invitation (`shop`) is outreach, not a wait.
 */
export function isWaiting(lead: { scope: LeadScope; askedBy: LeadAskedBy }): boolean {
  return lead.scope === "departure" && lead.askedBy === "diver";
}

/** The name and address to show for a lead: the person's, else the snapshot it kept. */
export function leadContact(row: {
  lead: { name: string | null; email: string | null };
  person: { fullName: string; email: string | null } | null;
}): { name: string | null; email: string | null } {
  return {
    name: row.person?.fullName ?? row.lead.name,
    email: row.person?.email ?? row.lead.email,
  };
}
