import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../../../print/_components/SheetLoading";

/**
 * The packet with the medical alerts arrives as sheets (issue #2745), so it
 * waits as one: the band, a few lines, the fold, at the packet paper's width
 * (ADR 20260804-instant-navigation). The same three-section document as the
 * departure's `?print=1`, with the alerts under the rows.
 */
export default function TripPrintWithMedicalAlertsLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
