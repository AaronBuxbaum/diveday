/** Operator-only mint: no application route imports this issuer. */
import type { PoolClient } from "pg";
import { DEMO_SIGN_IN_TTL_MS } from "@/lib/account-tokens";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { demoBypassEnabled } from "@/lib/demo-bypass";
import { isDemoAccountEmail } from "@/lib/demo-identity";
import { publicAppUrl } from "@/lib/notifications/app-url";

/** Caller owns the read/write transaction. Account lock serializes mint with consume/removal. */
export async function mintDemoLink(db: Pick<PoolClient, "query">, slug: string) {
  const origin = publicAppUrl();
  if (
    !origin ||
    !demoBypassEnabled() ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    slug.length > 150
  )
    return null;
  const result = await db.query<{ id: string; email: string }>(
    `select a.id, a.email from user_accounts a join people p on p.id = a.person_id
     join shops s on s.id = p.shop_id
     where s.slug = $1 and s.is_demo = true and a.status = 'active'
     and p.deleted_at is null and p.anonymized_at is null
     and exists (select 1 from person_roles r where r.person_id = p.id and r.role = 'owner')
     order by a.id for update of a`,
    [slug],
  );
  if (result.rows.length !== 1 || !isDemoAccountEmail(result.rows[0].email)) return null;
  const account = result.rows[0];
  const now = nowDate();
  const expiresAt = new Date(now.getTime() + DEMO_SIGN_IN_TTL_MS);
  const token = createBearerToken();
  await db.query(
    `update capabilities set revoked_at = $2 where user_account_id = $1
    and purpose = 'demo_sign_in' and used_at is null and revoked_at is null`,
    [account.id, now],
  );
  await db.query(
    `insert into capabilities (purpose, user_account_id, token_hash, issued_at, expires_at)
    values ('demo_sign_in', $1, $2, $3, $4)`,
    [account.id, hashBearerToken(token), now, expiresAt],
  );
  return {
    url: new URL(`/email-sign-in/${token}`, `${origin}/`).toString(),
    expiresAt: expiresAt.toISOString(),
  };
}
