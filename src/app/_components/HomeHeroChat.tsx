import { MarketingGroupChat } from "@/components/MarketingGroupChat";
import { MarketingHeroMotion } from "@/components/MarketingReveal";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/** The crew's lines in order; `marketing.home.chat.lines` holds one key per line. */
const LINES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;

/** The crew's group chat the night before the 7:30 boat, beside the homepage headline. */
export function HomeHeroChat({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  // i18n-exempt: sample crew names
  const names = { dana: "Dana", rob: "Rob", mia: "Mia" };
  return (
    <MarketingHeroMotion>
      <figure aria-label={t("marketing.home.chat.region")}>
        <MarketingGroupChat
          labels={{
            region: t("marketing.home.chat.region"),
            group: t("marketing.home.chat.group"),
            members: t("marketing.home.chat.members"),
            stamp: t("marketing.home.chat.stamp"),
            names,
            typing: {
              dana: t("marketing.home.chat.typing", { name: names.dana }),
              rob: t("marketing.home.chat.typing", { name: names.rob }),
              mia: t("marketing.home.chat.typing", { name: names.mia }),
            },
            lines: LINES.map((line) => t(`marketing.home.chat.lines.${line}`)),
            card: {
              title: t("marketing.home.chat.card.title"),
              readyBefore: t("marketing.home.chat.card.ready", { ready: 8 }),
              readyAfter: t("marketing.home.chat.card.ready", { ready: 9 }),
              needsYou: t("marketing.home.chat.card.needsYou"),
              // i18n-exempt: sample diver name shared with the booking walkthrough
              diver: "Tom Okafor",
              unsigned: t("marketing.home.chat.card.unsigned"),
              nudge: t("marketing.home.chat.card.nudge"),
              sent: t("marketing.home.chat.card.sent"),
              signed: t("marketing.home.chat.card.signed"),
            },
            composer: t("marketing.home.chat.composer"),
            replay: t("marketing.home.chat.replay"),
            note: t("marketing.home.chat.note"),
          }}
        />
      </figure>
    </MarketingHeroMotion>
  );
}
