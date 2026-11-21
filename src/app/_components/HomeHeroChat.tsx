import Image from "next/image";
import { MarketingGroupChat } from "@/components/MarketingGroupChat";
import { MarketingHeroMotion } from "@/components/MarketingReveal";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/** The crew's lines in order; `marketing.home.chat.lines` holds one key per line. */
const LINES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
] as const;

/** A face at the chat's avatar size; the name beside it is its label. */
function face(src: string) {
  return <Image src={src} width={56} height={56} alt="" className="size-7 object-cover" />;
}

/**
 * The demo shop's crew in a group chat the night before the 7:30 boat, beside
 * the homepage headline. The cast is the sample shop's own (`src/db/seed/cast.ts`),
 * so the faces here are the ones a visitor meets in the demo.
 */
export function HomeHeroChat({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  // i18n-exempt: sample crew names shared with the demo shop
  const names = { sal: "Sal", keiko: "Keiko", marcus: "Marcus" };
  return (
    <MarketingHeroMotion>
      <figure aria-label={t("marketing.home.chat.region")}>
        <MarketingGroupChat
          labels={{
            group: t("marketing.home.chat.group"),
            members: t("marketing.home.chat.members"),
            stamp: t("marketing.home.chat.stamp"),
            names,
            typing: {
              sal: t("marketing.home.chat.typing", { name: names.sal }),
              keiko: t("marketing.home.chat.typing", { name: names.keiko }),
              marcus: t("marketing.home.chat.typing", { name: names.marcus }),
            },
            avatars: {
              sal: face("/demo-staff/sal-moretti.webp"),
              keiko: face("/demo-staff/keiko-tanaka.webp"),
              marcus: face("/demo-staff/marcus-webb.webp"),
            },
            lines: LINES.map((line) => t(`marketing.home.chat.lines.${line}`)),
            card: {
              title: t("marketing.home.chat.card.title"),
              readyBefore: t("marketing.home.chat.card.ready", { ready: 8 }),
              readyAfter: t("marketing.home.chat.card.ready", { ready: 9 }),
              needsYou: t("marketing.home.chat.card.needsYou"),
              // i18n-exempt: sample diver name shared with the booking walkthrough
              diver: "Tom Okafor",
              avatar: face("/demo-divers/tom-okafor.webp"),
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
