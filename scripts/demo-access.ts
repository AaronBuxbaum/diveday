/** Operator-only, read-only demo lookup. Never imported by the application. */
import { Pool, type PoolClient } from "pg";
import { withExplicitSslMode } from "@/db/connection-string";
import { DEMO_BYPASS_PASSWORD, demoBypassEnabled } from "@/lib/demo-bypass";
import { isDemoAccountEmail } from "@/lib/demo-identity";
import { publicAppUrl } from "@/lib/notifications/app-url";

type DemoRow = { id: string; slug: string; name: string; created_at: Date };
type AccountRow = { email: string; role: string; status: string; deleted_at: Date | null };
type Reader = Pick<PoolClient, "query">;

export function parseDemoAccessArgs(args: string[]) {
  const [command, ...rest] = args;
  if (command !== "list" && command !== "credentials") throw new Error("usage");
  const values: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!value || !["--query", "--since", "--slug"].includes(key) || key in values)
      throw new Error("usage");
    values[key] = value;
  }
  if (command === "credentials") {
    if (
      Object.keys(values).length !== 1 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values["--slug"] ?? "")
    )
      throw new Error("usage");
  } else if (values["--slug"] || (values["--query"]?.length ?? 0) > 100) throw new Error("usage");
  if (
    values["--since"] &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(values["--since"])
  )
    throw new Error("usage");
  if (values["--since"] && !Number.isFinite(Date.parse(values["--since"])))
    throw new Error("usage");
  return {
    command,
    query: values["--query"] ?? "",
    since: values["--since"] ?? null,
    slug: values["--slug"],
  };
}

export async function listDemos(
  db: Reader,
  query: string,
  since: string | null,
): Promise<DemoRow[]> {
  // Position is literal substring matching, never caller-supplied LIKE patterns.
  const result = await db.query<DemoRow>(
    `select id, slug, name, created_at from shops
    where is_demo = true and ($2::timestamptz is null or created_at >= $2::timestamptz)
    and (position(lower($1) in lower(slug)) > 0 or position(lower($1) in lower(name)) > 0)
    order by created_at desc, id limit 100`,
    [query, since],
  );
  return result.rows;
}

export async function demoCredentials(db: Reader, slug: string) {
  const result = await db.query<DemoRow>(
    "select id, slug, name, created_at from shops where is_demo = true and slug = $1",
    [slug],
  );
  const shop = result.rows[0];
  if (!shop) return null;
  const accounts = await db.query<AccountRow>(
    `select a.email, r.role, a.status, p.deleted_at
    from people p join person_roles r on r.person_id = p.id
    join user_accounts a on a.person_id = p.id
    where p.shop_id = $1 and r.role in ('owner', 'captain')`,
    [shop.id],
  );
  // A toggled demo flag never makes a real owner's credentials available.
  if (!accounts.rows.length || accounts.rows.some((a) => !isDemoAccountEmail(a.email))) return null;
  const owners = accounts.rows.filter(
    (a) => a.role === "owner" && a.status === "active" && a.deleted_at === null,
  );
  if (owners.length !== 1) return null;
  return { shop, email: owners[0].email, password: DEMO_BYPASS_PASSWORD };
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  let options: ReturnType<typeof parseDemoAccessArgs>;
  try {
    options = parseDemoAccessArgs(args);
  } catch {
    console.error(
      "Usage: pnpm exec tsx scripts/demo-access.ts list [--query <slug-or-generated-name>] [--since <UTC-ISO-time>] | credentials --slug <exact-slug>",
    );
    return 1;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL must name the intended database; no local fallback or seed is used.",
    );
    return 1;
  }
  if (options.command === "credentials" && !demoBypassEnabled()) {
    console.error(
      "Demo sign-in is disabled in this environment. Use the deployment's runtime configuration.",
    );
    return 1;
  }
  const pool = new Pool({
    connectionString: withExplicitSslMode(url),
    max: 1,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
  });
  const client = await pool.connect().catch(async (error: unknown) => {
    await pool.end();
    throw error;
  });
  try {
    await client.query("begin transaction isolation level repeatable read read only");
    if (options.command === "list") {
      console.log(JSON.stringify(await listDemos(client, options.query, options.since), null, 2));
      console.error(
        "At most 100 newest matches. Match the requester using their URL/history/screenshot and visit time; no email or typed visitor shop name is stored. Confirm the exact slug before credentials.",
      );
    } else {
      const found = await demoCredentials(client, options.slug ?? "");
      const origin = publicAppUrl();
      if (!found || !origin) {
        console.error(
          "No eligible demo owner found, or public origin is not configured. No credentials emitted.",
        );
        return 1;
      }
      console.log(
        JSON.stringify(
          {
            shop: found.shop.slug,
            signInUrl: `${origin}/sign-in`,
            email: found.email,
            password: found.password,
            warning:
              "Sample shop only. No real customer data. Temporary demo may be removed at any time; normally cleared after seven days.",
          },
          null,
          2,
        ),
      );
    }
    return 0;
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      // Driver errors can quote connection strings or rows. Keep output generic.
      console.error(
        "Demo lookup failed. Check database connectivity and configuration; no error details printed.",
      );
      process.exitCode = 1;
    },
  );
}
