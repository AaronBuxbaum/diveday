import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { commitCounterPaymentHold } from "@/db/counter-payment-hold";
import { getShopById } from "@/db/shops";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { isCrossSiteHeaders } from "@/lib/same-origin";
import { hasRequiredStepUp } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

const body = z.object({ heldId: z.uuid() });

/**
 * **The order page left inside a counter payment's hold** (issue #3030,
 * review of #3061, dde-a F2). The page sends this with `keepalive` as it goes
 * (closed, hidden, or a navigation inside the app), and the hold is recorded
 * now, stamped with the tap's time, rather than by the hourly sweep: the
 * order stops reading Open and Stripe stops asking the diver within seconds.
 *
 * The same gate as the release action it stands in for: a staff session of
 * this shop, the money step-up the tap asked, and only a `counter_payment`
 * row of this shop (`commitCounterPaymentHold`). A cookie-authenticated POST
 * from another site is refused before the session is read, against the host
 * the request was sent to (`isCrossSiteHeaders`): behind a proxy the
 * handler's own `request.url` need not carry the page's origin.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ shopSlug: string; id: string }> },
) {
  if (isCrossSiteHeaders(request.headers)) return new Response(null, { status: 403 });
  const { shopSlug } = await params;
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop || shop.slug !== shopSlug) return new Response(null, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  if (!(await hasRequiredStepUp(db, session, "money"))) {
    return new Response(null, { status: 403 });
  }
  const left = await commitCounterPaymentHold(db, {
    shopId: shop.id,
    heldId: parsed.data.heldId,
  });
  if (left.status === "done") {
    revalidatePath(shopPath(shop.slug, "orders", left.orderId));
    revalidatePath(shopPath(shop.slug, "orders"));
    if (left.outcome.outcome.ok) dispatchIntegrationsAfterResponse();
  }
  return new Response(null, { status: 204 });
}
