import { describe, expect, it } from "vitest";
import { CUSTOMER_ADDRESS_FIELDS, customerAddressFromForm } from "./customer-address-form";

function form(values: Partial<Record<keyof typeof CUSTOMER_ADDRESS_FIELDS, string>>) {
  const data = new FormData();
  for (const [part, field] of Object.entries(CUSTOMER_ADDRESS_FIELDS)) {
    data.set(field, values[part as keyof typeof CUSTOMER_ADDRESS_FIELDS] ?? "");
  }
  return data;
}

describe("customerAddressFromForm", () => {
  it("reads a usable address and upper-cases the country", () => {
    expect(
      customerAddressFromForm(
        form({
          line1: " 1 Ocean Dr ",
          city: "Key Largo",
          state: "FL",
          postalCode: "33037",
          country: "us",
        }),
      ),
    ).toEqual({
      line1: "1 Ocean Dr",
      line2: "",
      city: "Key Largo",
      state: "FL",
      postalCode: "33037",
      country: "US",
    });
  });

  it("answers undefined for an untouched fieldset or a malformed country, never refuses", () => {
    expect(customerAddressFromForm(form({}))).toBeUndefined();
    expect(
      customerAddressFromForm(
        form({ line1: "1 Ocean Dr", city: "Key Largo", postalCode: "33037", country: "USA" }),
      ),
    ).toBeUndefined();
  });
});
