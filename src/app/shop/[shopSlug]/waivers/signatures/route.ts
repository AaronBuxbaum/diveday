import type { NextRequest } from "next/server";
import { requireStaffSession } from "@/lib/session";

/**
 * 308 to `/waivers`, which is now the whole waiver surface — the release and
 * the signature log on one page (ADR 20260827-people-not-lists, decision 4).
 *
 * A Route Handler, not a `page.tsx` calling `permanentRedirect()`: under
 * `cacheComponents` a page is partially prerendered, so a redirect thrown from
 * its body answers **200** with the hop resolving in the streamed payload — a
 * browser follows it, a bookmark, a crawler, and a `curl` do not. And it
 * re-checks the session server-side (ADR-0006) rather than trusting the edge
 * proxy alone, same as its `/blockers`, `/trips/new`, `/settings/backup`, and
 * `/dive-sites/catalog` siblings.
 *
 * Both query parameters carry over, because both are how a reviewer arrives:
 * `?record=` is the trip roster's "View signed record" deep link, and `?page=`
 * is a bookmark into deep signed history. `?record=` also gains the row's
 * fragment, which is what opens the pinned row and scrolls to it now that it
 * sits inside its day group rather than in a section of its own.
 *
 * The role gate is deliberately *not* repeated here: this hands the visitor to
 * `/waivers`, which runs `canPersonManageWaiverTemplates` before it renders a
 * byte. What this call adds is the signed-in check, so an anonymous visitor
 * still meets sign-in at this URL rather than being bounced twice.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  await requireStaffSession();
  const { shopSlug } = await params;
  const query = new URLSearchParams();
  const record = request.nextUrl.searchParams.get("record");
  const page = request.nextUrl.searchParams.get("page");
  if (page) query.set("page", page);
  if (record) query.set("record", record);
  const search = query.toString();
  // A relative `Location`, by hand: `NextResponse.redirect()` demands an
  // absolute URL, and whichever host it resolves pins the visitor to that host
  // — in the e2e fleet it resolved `localhost` for a session cookied to
  // `127.0.0.1` and landed a signed-in owner on /sign-in.
  //
  // The fragment is appended verbatim from a value that has already been
  // through `URLSearchParams`, so a hand-typed `?record=` cannot smuggle a
  // second `#` or a `?` into the path; `/waivers` then parses it with
  // `uuidParam` before it reaches a query at all.
  const fragment = record ? `#waiver-record-${encodeURIComponent(record)}` : "";
  return new Response(null, {
    status: 308,
    headers: {
      Location: `/shop/${encodeURIComponent(shopSlug)}/waivers${search ? `?${search}` : ""}${fragment}`,
    },
  });
}
