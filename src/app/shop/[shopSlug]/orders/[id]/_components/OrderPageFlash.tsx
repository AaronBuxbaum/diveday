import { FlashParams } from "@/components/FlashParams";
import { uuidParam } from "@/lib/uuid";
import { ClearCreatedInvoice } from "../../new/ClearCreatedInvoice";

export function OrderPageFlash({ scope, receipt }: { scope: string; receipt?: string }) {
  const completion = uuidParam(receipt);
  return (
    <>
      <FlashParams params={["notice", "invoiceCreated"]} />
      {completion ? <ClearCreatedInvoice scope={scope} receipt={completion} /> : null}
    </>
  );
}
