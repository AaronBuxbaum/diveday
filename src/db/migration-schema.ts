import { boolean } from "drizzle-orm/pg-core";
import { makeRentalFitProfiles } from "./schema/gear";

export * from "./schema";

// Migration generation retains this physical column for one release while
// runtime queries use the narrower table from schema/gear. The next release
// removes this override and generates the drop after this code is serving.
export const rentalFitProfiles = makeRentalFitProfiles({
  retiringRentsMaskFins: boolean("rents_mask_fins").notNull().default(false),
});
