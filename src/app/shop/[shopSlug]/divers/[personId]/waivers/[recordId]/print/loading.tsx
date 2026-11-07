import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../../../../print/_components/SheetLoading";

/** A signed release arrives as a sheet of the shop's paper (issue #4142), so it waits as one. */
export default function SignedWaiverSheetLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
