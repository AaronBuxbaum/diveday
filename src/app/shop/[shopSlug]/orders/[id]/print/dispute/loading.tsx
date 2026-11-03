import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../../../print/_components/SheetLoading";

/** The dispute sheet arrives as a sheet of the shop's paper (issue #2745), so it waits as one. */
export default function DisputeSheetLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
