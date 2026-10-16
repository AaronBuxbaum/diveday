import { redirect } from "next/navigation";
import { readinessLinkPath } from "@/lib/booking-capabilities";

/**
 * **A terminal card never nests inside the booked shell** (#2429). Every
 * terminal card of the readiness page (unavailable, cancelled, the after-dive
 * states) renders its own `<main>` and frame; under the booked header that
 * would stack two mains, "You've got a seat" above "Your booking was
 * cancelled". Reached only by a race with a staff cancel or a boat coming
 * home, so the stream leaves for the plain URL, whose fast path declines and
 * which owns these cards.
 *
 * Returns the function the page wraps each terminal card in: the card itself
 * on the plain URL, a redirect to it under the booked header.
 */
export function terminalCardIn(underBookedHeader: boolean, token: string) {
  const leave = () => redirect(readinessLinkPath(token));
  return <Card>(card: Card) => (underBookedHeader ? leave() : card);
}
