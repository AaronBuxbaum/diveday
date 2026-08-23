import { EntryDone } from "@/components/account/EntryShell";
import type { Shop } from "@/db/schema";
import type { DiverTranslator } from "@/i18n/messages";
import { telHref } from "@/lib/contact-links";

/**
 * **What a bearer-token page says when the link is dead.**
 *
 * One shape for all of them, because there is one situation: a diver is
 * holding a phone, they were told to open this, and it does not work. The
 * question they have is *who do I ask* — so where the token resolves to a real
 * record, the card names the shop and hands over a way to reach it.
 *
 * The waiver page reasoned this out first and its comments carry the finding:
 * the expired branch "used to bail out before the shop (and so its contact
 * info) was ever loaded". `/ready` and `/recap` still did, and `/ready` is the
 * link in the **24-hour trip reminder** — so every ordinary way of reaching an
 * expired one (a bookmark from last season, a forwarded email, a reminder for
 * a trip that moved) ended on four words telling the diver to ask a shop the
 * page would not name (issue #801).
 *
 * **`shop` stays optional, and that is the security-relevant half.** A token
 * that resolves *no* record has no shop to attribute it to without weakening
 * the guarantee the model rests on — a bearer token reveals only its own
 * record. Every caller keeps its bare notice for that case. What a resolvable
 * token reveals is the shop's own published name and contact details, which is
 * what the diver came for and nothing the shop hides.
 *
 * `EntryDone` is the app's one warm terminal pattern (design principle 4), and
 * `⏳` is the app-wide "this link has run out" mark — decorative, with the
 * heading carrying the meaning. `children` is where a card that can offer a
 * way forward puts it, above the contact line.
 */
export function ExpiredLinkCard({
  title,
  text,
  shop,
  t,
  children,
}: {
  title: string;
  text: string;
  shop?: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  t?: DiverTranslator;
  children?: React.ReactNode;
}) {
  const contact =
    shop && t ? (
      <p className="text-muted">
        {shop.contactEmail || shop.contactPhone
          ? t.rich("common.needHelpContact", {
              shop: shop.name,
              link: (chunks) => (
                <a
                  href={
                    shop.contactEmail
                      ? `mailto:${shop.contactEmail}`
                      : telHref(shop.contactPhone ?? "")
                  }
                  className="font-medium text-primary hover:underline"
                >
                  {chunks}
                </a>
              ),
            })
          : t("common.needHelpPlain", { shop: shop.name })}
      </p>
    ) : null;
  return (
    <EntryDone
      glyph="⏳"
      title={title}
      text={text}
      action={
        // One gapped column rather than each piece carrying its own top
        // margin: the pieces above the contact line come and go by branch, and
        // per-item margins are how a stack ends up spaced differently
        // depending on which of its parts happen to be there.
        children || contact ? (
          <div className="flex flex-col items-center gap-4">
            {children}
            {contact}
          </div>
        ) : undefined
      }
    />
  );
}
