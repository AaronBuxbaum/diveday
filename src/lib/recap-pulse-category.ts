/** Client-safe projection shared by UI and the feature store; no runtime database import. */
import type { recapPulseCategory } from "@/db/schema";

export type RecapPulseCategory = (typeof recapPulseCategory.enumValues)[number];
