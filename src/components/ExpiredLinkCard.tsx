import Link from "next/link";
import { type DoorGlyphId, EntryDone } from "@/components/account/EntryShell";
import { buttonClass } from "@/components/ui/button";
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
 * record. Every caller keeps its bare notice for that case, which wears
 * DiveDay's own wordmark in the shop's place. What a resolvable
 * token reveals is the shop's own published name and contact details, which is
 * what the diver came for and nothing the shop hides.
 *
 * `EntryDone` is the app's one warm terminal pattern (design principle 4), and
 * the `expired` mark — a drawn clock, never a typed one (ADR
 * 20260827-first-light, decision 2) — is what every dead link in the app
 * wears. It is decorative; the heading carries the meaning. `children` is
 * where a card that can offer a way forward puts it, above the contact line.
 *
 * **The mark is a caller's choice, because the card outgrew its name.** The
 * shape here — a terminal statement, plus the shop to ask about it — is what a
 * *live* link owes a diver whose booking or departure ended somewhere other
 * than the water, and those readers must not be told their link has run out
 * when it plainly has not. `cancelled` is the app's mark for those (the same
 * one `/ready`'s cancelled notice wears), and it defaults to `expired` so
 * every existing caller reads exactly as before.
 *
 * **A shopless card still has a door** (UX review 2026-10-10, item 11). With no
 * shop to name, the card used to end on "Ask your dive shop for a fresh link"
 * and nothing to tap, a dead end under DiveDay's own wordmark. Given `t`, it
 * offers DiveDay's home as the one place it can honestly point; with a shop it
 * offers that shop's contact instead and never DiveDay's sales page.
 */
export function ExpiredLinkCard({
  title,
  text,
  glyph = "expired",
  shop,
  t,
  wordmark = !shop,
  children,
}: {
  title: string;
  text: string;
  /** A drawn mark, decorative — the heading carries the meaning. */
  glyph?: DoorGlyphId;
  shop?: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  t?: DiverTranslator;
  /**
   * DiveDay's mark above the card. On by default only where no shop is named;
   * `DeadLink` turns it on everywhere, so every dead link looks the same
   * (visual review 2026-10-24, B29).
   */
  wordmark?: boolean;
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
  const diveDayDoor =
    !shop && t ? (
      <Link href="/" className={buttonClass({ variant: "secondary" })}>
        {t("common.diveDayDoor")}
      </Link>
    ) : null;
  return (
    <EntryDone
      // No shop to name: DiveDay's mark says whose page this is, so a diver on
      // a dead link is not left on a blank screen (UX audit #28), and the
      // DiveDay door below is the way off it.
      wordmark={wordmark}
      glyph={glyph}
      title={title}
      text={text}
      action={
        // One gapped column rather than each piece carrying its own top
        // margin: the pieces above the contact line come and go by branch, and
        // per-item margins are how a stack ends up spaced differently
        // depending on which of its parts happen to be there.
        children || contact || diveDayDoor ? (
          <div className="flex flex-col items-center gap-4">
            {children}
            {contact}
            {diveDayDoor}
          </div>
        ) : undefined
      }
    />
  );
}
