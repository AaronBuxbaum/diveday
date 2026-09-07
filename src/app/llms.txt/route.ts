import { connection, type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { diveSpecialty } from "@/db/schema";
import { listShopsForSitemap } from "@/db/shops";
import { renderLlmsTxt } from "@/lib/llms-txt";
import { publicAppUrl } from "@/lib/notifications";

/**
 * `/llms.txt` — the site-level overview an agent reads first (issue #1427).
 * Words in `src/lib/llms-txt.ts`; this route only decides which shops appear
 * (the sitemap's own scope, so a shop that opted out of search is absent) and
 * how long a reader may keep the answer.
 *
 * `connection()` before the read: the shop list is live data, and a
 * prerendered copy would list whoever was signed up at the last deploy. The
 * hour on the `Cache-Control` is the ceiling on that staleness instead —
 * the same bound `sitemap.ts` puts on itself.
 */
export async function GET(request: NextRequest) {
  await connection();
  const origin = publicAppUrl() ?? new URL(request.url).origin;
  const shops = await listShopsForSitemap(await getDb());
  return new NextResponse(
    renderLlmsTxt({ origin, shops, specialtyCodes: diveSpecialty.enumValues }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
