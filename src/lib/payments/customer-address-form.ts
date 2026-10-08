import { z } from "zod";
import { type InvoiceCustomerAddress, isUsableInvoiceCustomerAddress } from "./invoicing";

/**
 * **The billing address a staff invoice form posts**, read back into the shape
 * `createOrder` sends Stripe. One reader for every form that raises an invoice
 * (the new-order form, the counter rental's), so the six field names and their
 * bounds cannot drift between two copies.
 *
 * Parsed, never refused here: an address that is missing or unusable comes back
 * `undefined`, and `createOrder` decides what that means — a demo shop bills
 * itself, a real shop with Stripe Tax on is told `tax_location_required`.
 */
const customerAddressSchema = z.object({
  line1: z.string().trim().max(200),
  line2: z.string().trim().max(200),
  city: z.string().trim().max(100),
  state: z.string().trim().max(100),
  postalCode: z.string().trim().max(30),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase()),
});

/** The form field each part of the address is posted under. */
export const CUSTOMER_ADDRESS_FIELDS = {
  line1: "customerAddressLine1",
  line2: "customerAddressLine2",
  city: "customerAddressCity",
  state: "customerAddressRegion",
  postalCode: "customerAddressPostalCode",
  country: "customerAddressCountry",
} as const;

export function customerAddressFromForm(formData: FormData): InvoiceCustomerAddress | undefined {
  const read = (field: string) => String(formData.get(field) ?? "");
  const parsed = customerAddressSchema.safeParse({
    line1: read(CUSTOMER_ADDRESS_FIELDS.line1),
    line2: read(CUSTOMER_ADDRESS_FIELDS.line2),
    city: read(CUSTOMER_ADDRESS_FIELDS.city),
    state: read(CUSTOMER_ADDRESS_FIELDS.state),
    postalCode: read(CUSTOMER_ADDRESS_FIELDS.postalCode),
    country: read(CUSTOMER_ADDRESS_FIELDS.country),
  });
  return parsed.success && isUsableInvoiceCustomerAddress(parsed.data) ? parsed.data : undefined;
}
