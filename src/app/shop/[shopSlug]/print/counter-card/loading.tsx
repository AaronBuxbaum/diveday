import { COUNTER_CARD_PAPER } from "@/lib/print-sheets";
import { SheetLoading } from "../_components/SheetLoading";

/** The card's own paper, held at its real size while the read lands. */
export default function CounterCardLoading() {
  return <SheetLoading paper={COUNTER_CARD_PAPER} />;
}
