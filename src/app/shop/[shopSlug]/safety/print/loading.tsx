import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../print/_components/SheetLoading";

/** The Safety record arrives as a sheet (issue #2745), so it waits as one. */
export default function SafetyPrintLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
