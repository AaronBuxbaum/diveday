import type { DiverProfile } from "../_components/shared";

/**
 * Shared gate for the story's invoice link and the ledger's Collect action:
 * order permission must be true, payments must be connected, and the diver
 * must not be deleted. Missing permission fails closed. Surface eligibility
 * remains with the caller.
 */
export function canRaiseInvoiceFor(
  diver: Pick<DiverProfile, "person">,
  reader: { canManageOrders: boolean | undefined; paymentsConnected: boolean },
): boolean {
  return Boolean(reader.canManageOrders) && reader.paymentsConnected && !diver.person.deletedAt;
}
