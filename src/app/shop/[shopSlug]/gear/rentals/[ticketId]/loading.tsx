import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../../print/_components/SheetLoading";

/** The counter ticket's slip, held at the packet paper's width while the rental is read (issue #2745). */
export default function CounterRentalTicketLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
