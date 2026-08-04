/**
 * A shop's physical address, as the diver-facing surfaces need it.
 *
 * Every part is optional and a shop can be fully set up with none of them
 * (`shops.address_*` — see the schema comment): DiveDay never guesses a street
 * on a shop's behalf, so these helpers return `[]`/`null` rather than
 * inventing a partial line, and a caller renders nothing when they do.
 *
 * Codes and fragments only — the shop's own typed words are passed through
 * verbatim, and no sentence is composed here (AGENTS.md: `src/lib` returns
 * codes, not copy).
 */
export type ShopAddressParts = {
  street: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
};

function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * The address as display lines in postal order — street on its own, then
 * "locality, region postcode", then country. Empty parts are dropped rather
 * than leaving stray commas.
 */
export function shopAddressLines(address: ShopAddressParts): string[] {
  const street = clean(address.street);
  const locality = clean(address.locality);
  const region = clean(address.region);
  const postalCode = clean(address.postalCode);
  const country = clean(address.country);

  const cityLine = [locality, [region, postalCode].filter(Boolean).join(" ").trim() || null]
    .filter(Boolean)
    .join(", ");

  return [street, cityLine || null, country].filter((line): line is string => Boolean(line));
}

/**
 * A single-line query a map provider can resolve, or `null` when there is not
 * enough on file to point at a real place.
 *
 * The bar is deliberately a street *or* a locality: a query of nothing but a
 * shop name and a country would centre a map on the middle of a continent and
 * present it as the shop's front door.
 */
export function shopMapQuery(shopName: string, address: ShopAddressParts): string | null {
  const lines = shopAddressLines(address);
  if (!clean(address.street) && !clean(address.locality)) return null;
  return [shopName.trim(), ...lines].filter(Boolean).join(", ");
}
