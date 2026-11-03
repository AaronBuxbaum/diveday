import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../print/_components/SheetLoading";

/**
 * The crew rota arrives as a sheet (issue #2745), so it waits as one, at the
 * packet paper's width (ADR 20260804-instant-navigation).
 */
export default function StaffingPrintLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
