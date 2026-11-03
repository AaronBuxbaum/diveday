import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../../../print/_components/SheetLoading";

/** The claim tag arrives as a sheet (issue #2745), so it waits as one, at the packet paper's width. */
export default function ClaimTagLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
