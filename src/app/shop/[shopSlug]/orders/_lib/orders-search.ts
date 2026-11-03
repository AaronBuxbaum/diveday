import type { NewOrderSearch } from "../_components/NewOrderPanel";

/** The orders index URL: its ledger filters plus the add panel (`?add=1`). */
export type OrdersSearch = NewOrderSearch & {
  status?: string;
  /** The toolbar's one search box — diver name, departure title, order note. */
  q?: string;
  /** One departure's orders — the trip pulse's awaiting-payment fact links here. */
  tripId?: string;
  seats?: string;
  from?: string;
  to?: string;
  range?: string;
  page?: string;
  importedPage?: string;
};
