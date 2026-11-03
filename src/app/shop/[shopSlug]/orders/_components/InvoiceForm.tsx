import type { ComponentProps } from "react";
import { InvoicePendingFields } from "./InvoicePendingFields";

/** Customer, billing location and lines share one target lifecycle, including query-only navigation. */
export function InvoiceForm({
  identity,
  children,
  ...props
}: ComponentProps<"form"> & { identity: string }) {
  return (
    <form key={identity} {...props}>
      <InvoicePendingFields label={props["aria-label"]}>{children}</InvoicePendingFields>
    </form>
  );
}
