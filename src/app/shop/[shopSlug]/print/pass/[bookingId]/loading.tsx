import { printSheetSpec } from "@/lib/print-sheets";
import { SheetLoading } from "../../_components/SheetLoading";

/** The sheet's own paper, held at its real size while the read lands. */
export default function PaperPassLoading() {
  return <SheetLoading paper={printSheetSpec("paper_pass").paper} />;
}
