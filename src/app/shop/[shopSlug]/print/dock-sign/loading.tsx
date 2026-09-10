import { printSheetSpec } from "@/lib/print-sheets";
import { SheetLoading } from "../_components/SheetLoading";

/** The sheet's own paper, held at its real size while the read lands. */
export default function DockSignLoading() {
  return <SheetLoading paper={printSheetSpec("dock_sign").paper} />;
}
