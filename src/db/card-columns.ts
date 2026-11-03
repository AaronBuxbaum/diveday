import { sql } from "drizzle-orm";
import { cards } from "./schema";
import type { CertificationLevel } from "@/lib/certification-levels";
import type { DiveSpecialty } from "./schema";

/**
 * **`cards.level` and `cards.specialty` typed for a query that already filters
 * the kind** (issue #2722). Both columns are nullable on the ledger because a
 * card carries one or neither, and `cards_kind_shape` makes `level` non-null on
 * every `kind = 'level'` row and `specialty` non-null on every `kind =
 * 'specialty'` row. A projection that reads them under that filter selects
 * these instead of casting each row: use them **only** beside the matching
 * `eq(cards.kind, …)`, never in a query that reads every kind.
 */
export const levelCardLevel = sql<CertificationLevel>`${cards.level}`;

/** `cards.specialty` for a query filtered to `kind = 'specialty'`; see {@link levelCardLevel}. */
export const specialtyCardSpecialty = sql<DiveSpecialty>`${cards.specialty}`;
