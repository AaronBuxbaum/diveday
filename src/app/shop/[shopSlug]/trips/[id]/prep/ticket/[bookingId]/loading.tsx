import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../../../../print/_components/SheetLoading";

/** The rental slip arrives as a sheet (issue #2745), so it waits as one, at the packet paper's width. */
export default function RentalTicketLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
