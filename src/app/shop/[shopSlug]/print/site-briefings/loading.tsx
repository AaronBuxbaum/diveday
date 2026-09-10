import { printSheetSpec } from "@/lib/print-sheets";
import { SheetLoading } from "../_components/SheetLoading";

/** The sheet's own paper, held at its real size while the read lands. */
export default function SiteBriefingsLoading() {
  return <SheetLoading paper={printSheetSpec("site_briefing").paper} />;
}
