import Link from "next/link";
import type { ReactNode } from "react";
import { ShopNotice } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";

/**
 * The one door every "connect payments first" fallback opens —
 * `/shop/<slug>/settings#money`, the anchor the Stripe Connect card on
 * Settings owns. Kept beside the two CTAs below, which are its only callers.
 */
function paymentsConnectHref(shopSlug: string): string {
  return `/shop/${shopSlug}/settings#money`;
}

/**
 * The payments-not-connected call to action, in the two shapes it's needed:
 * a button-style link (Orders' header action and empty state) or an inline
 * banner sentence (Promo codes, where the link sits mid-message). Both end
 * at the same place, so this is the one source for that link — words stay
 * with the caller per the staff-copy rule (`AGENTS.md`), passed in as
 * `label`/`message` rather than authored here.
 */
export function PaymentsConnectCta(
  props:
    | { variant?: "button"; shopSlug: string; label: string; className?: string }
    | { variant: "banner"; message: ReactNode; className?: string },
) {
  if (props.variant === "banner") {
    return (
      <div className={props.className ?? "mb-6"}>
        <ShopNotice tone="warning" role="status">
          {props.message}
        </ShopNotice>
      </div>
    );
  }
  return (
    <Link
      href={paymentsConnectHref(props.shopSlug)}
      className={buttonClass({ className: props.className })}
    >
      {props.label}
    </Link>
  );
}
