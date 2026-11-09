/** Local operator UI. Possession of an explicit database connection gates launch; never deployed. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { Pool } from "pg";
import { withExplicitSslMode } from "@/db/connection-string";
import { demoBypassEnabled } from "@/lib/demo-bypass";
import { demoCredentials } from "./demo-access";

export function authorizedBrowserRequest(
  req: Pick<IncomingMessage, "headers" | "method">,
  origin: string,
  secret: string,
) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(req.headers.authorization ?? "");
  return (
    req.method === "POST" &&
    req.headers.origin === origin &&
    req.headers.host === new URL(origin).host &&
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}

export async function startShopBrowser(connectionString: string) {
  if (!connectionString) throw new Error("Explicit DATABASE_URL required");
  const pool = new Pool({
    connectionString: withExplicitSslMode(connectionString),
    max: 1,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    query_timeout: 12000,
  });
  const secret = randomBytes(32).toString("base64url");
  let origin = "";
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    try {
      if (req.headers.host !== new URL(origin).host) {
        res.writeHead(403).end();
        return;
      }
      const url = new URL(req.url ?? "/", origin);
      if (req.method === "GET" && ["/", "/app.js", "/style.css"].includes(url.pathname)) {
        const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        res.setHeader(
          "Content-Type",
          file.endsWith("html")
            ? "text/html; charset=utf-8"
            : file.endsWith("js")
              ? "text/javascript"
              : "text/css",
        );
        res.end(await readFile(new URL(`./shop-browser/${file}`, import.meta.url)));
        return;
      }
      if (!authorizedBrowserRequest(req, origin, secret)) {
        res.writeHead(403).end();
        return;
      }
      const client = await pool.connect();
      try {
        await client.query("begin transaction isolation level repeatable read read only");
        let result: unknown;
        if (url.pathname === "/shops") {
          const query = (url.searchParams.get("q") ?? "").slice(0, 100);
          const after = (url.searchParams.get("after") ?? "").slice(0, 150);
          const { rows } = await client.query(
            `select name, slug, is_demo from shops where slug > $2
             and (position(lower($1) in lower(name)) > 0 or position(lower($1) in lower(slug)) > 0)
             order by slug limit 51`,
            [query, after],
          );
          result = { rows: rows.slice(0, 50), next: rows.length > 50 ? rows[49].slug : null };
        } else if (url.pathname === "/demo") {
          const slug = url.searchParams.get("slug") ?? "";
          result =
            demoBypassEnabled() && slug.length <= 150 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
              ? await demoCredentials(client, slug)
              : null;
        } else {
          res.writeHead(404).end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
      } finally {
        await client.query("rollback").catch(() => undefined);
        client.release();
      }
    } catch {
      res.writeHead(503).end("Unavailable");
    }
  });
  server.requestTimeout = 15000;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local listener");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/#${secret}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    },
  };
}

if (import.meta.main) {
  startShopBrowser(process.env.DATABASE_URL ?? "")
    .then((browser) => {
      console.log(`Open this private local URL: ${browser.url}`);
      console.log(
        "Read-only operator browser. Stop with Ctrl+C. No real-shop sign-in or email action.",
      );
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => {
          void browser.close();
        });
    })
    .catch(() => {
      console.error("Shop browser failed. Explicit database access is required.");
      process.exitCode = 1;
    });
}
