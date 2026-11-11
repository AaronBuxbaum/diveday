import { PACKET_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../../../../print/_components/SheetLoading";

/**
 * The departure log arrives as a sheet (issue #2745), so it waits as one: the
 * band, a few lines, the fold, at the packet paper's width
 * (ADR 20260804-instant-navigation).
 */
export default function IncidentExportLoading() {
  return <SheetLoading paper={PACKET_PAPER} />;
}
