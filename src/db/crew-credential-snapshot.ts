import { type SQL, sql } from "drizzle-orm";
import { staffCredentials } from "./schema";

/** Read committed credential facts inside the same statement that appends the crew mark. */
export function crewCredentialSnapshot(shopId: string, personId: string): SQL {
  return sql`(select coalesce(jsonb_agg(jsonb_build_object(
    'kind', ${staffCredentials.kind}, 'issuedAt', ${staffCredentials.issuedAt},
    'renewsAt', ${staffCredentials.renewsAt}) order by ${staffCredentials.id}), '[]'::jsonb)
    from ${staffCredentials} where ${staffCredentials.shopId} = ${shopId}
      and ${staffCredentials.personId} = ${personId} and ${staffCredentials.deletedAt} is null)`;
}
