import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../../print/_components/SheetLoading";

/** The blank release arrives as a sheet of the shop's paper (issue #2745), so it waits as one. */
export default function BlankReleaseLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
