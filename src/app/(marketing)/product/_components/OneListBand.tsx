import Link from "next/link";
import { Eyebrow } from "@/app/_components/Eyebrow";
import { AppBar, MOCK_BODY } from "@/components/MarketingScreenFallbacks";
import { MarketingMockup } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { DiverTranslator } from "@/i18n/messages";
import { switchingHref } from "@/lib/funnel";

const TOOLS = ["calendar", "waiver", "clipboard"] as const;
const TOOL_CHIPS = {
  calendar: ["c0", "c1", "c2"],
  waiver: ["c0", "c1"],
  clipboard: ["c0", "c1"],
} as const;
const WHERE_ROWS = ["seat", "release", "card", "sizes", "count"] as const;

const CHIP = "rounded-full px-2 py-0.5 text-xs font-medium";
const CHIP_OK = `${CHIP} bg-success-tint text-success-strong`;
const CHIP_WARN = `${CHIP} bg-warning-tint text-warning-strong`;
const CHIP_PLAIN = `${CHIP} border border-border text-muted`;

/**
 * **One list instead of three tools** (marketing concept 04, 2026-11-16). The
 * patchwork a shop runs today (a booking calendar, a waiver app, a clipboard)
 * drawn beside the one list that replaces it, a table of who enters each
 * record once, and the honest edge: what DiveDay does not replace. The sample
 * names are the marketing mocks' own and are not read from the product.
 */
export function OneListBand({ t }: { t: DiverTranslator }) {
  const k = (key: string) => `marketing.product.oneList.${key}` as never;
  return (
    <section aria-labelledby="one-list-title" className="border-y border-border bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-14 lg:py-20">
        <div className="max-w-3xl">
          <Eyebrow>{t(k("eyebrow"))}</Eyebrow>
          <h2 id="one-list-title" className={`mt-4 ${BANNER_TITLE_CLASS}`}>
            {t(k("title"))}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted">{t(k("lede"))}</p>
        </div>

        <div
          role="img"
          aria-label={t(k("diagramLabel"))}
          className="mt-10 grid items-center gap-5 lg:grid-cols-[1fr_auto_1.25fr]"
        >
          <ul className="space-y-3" aria-hidden="true">
            {TOOLS.map((tool) => (
              <li
                key={tool}
                className="rounded-inset border border-dashed border-border bg-background p-4"
              >
                <p className="font-semibold">{t(k(`tools.${tool}.name`))}</p>
                <p className="text-sm text-muted">{t(k(`tools.${tool}.knows`))}</p>
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {TOOL_CHIPS[tool].map((c) => (
                    <span key={c} className={CHIP_PLAIN}>
                      {t(k(`tools.${tool}.has.${c}`))}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
          <span aria-hidden="true" className="text-center text-3xl text-primary max-lg:rotate-90">
            →
          </span>
          <MarketingMockup label={t(k("afterLabel"))} className="w-full">
            <div aria-hidden="true" className="bg-background">
              <AppBar label={t(k("sampleTrip"))} />
              <div className={`${MOCK_BODY} space-y-3`}>
                <Row name="Priya Sharma" detail={t(k("sampleGear"))}>
                  <span className={CHIP_OK}>{t(k("chips.paid"))}</span>
                  <span className={CHIP_OK}>{t(k("chips.signed"))}</span>
                  <span className={CHIP_OK}>{t(k("chips.cardChecked"))}</span>
                  <span className={`${CHIP} bg-primary text-primary-foreground`}>
                    {t(k("chips.aboard"))}
                  </span>
                </Row>
                <Row name="Tom Okafor" detail={t(k("sampleOwnGear"))}>
                  <span className={CHIP_OK}>{t(k("chips.paid"))}</span>
                  <span className={CHIP_OK}>{t(k("chips.signed"))}</span>
                  <span className={CHIP_OK}>{t(k("chips.cardChecked"))}</span>
                  <span className={CHIP_PLAIN}>{t(k("chips.notAboard"))}</span>
                </Row>
                <Row name="Hana Sato" detail={t(k("sampleGearSmall"))}>
                  <span className={CHIP_OK}>{t(k("chips.deposit"))}</span>
                  <span className={CHIP_WARN}>{t(k("chips.notSigned"))}</span>
                  <span className={CHIP_PLAIN}>{t(k("chips.sendWaiver"))}</span>
                </Row>
                <p className="text-sm text-muted">{t(k("sampleMore"))}</p>
              </div>
            </div>
          </MarketingMockup>
        </div>

        <div className="mt-14 max-w-3xl">
          <Eyebrow as="h3">{t(k("whereEyebrow"))}</Eyebrow>
          <p className={`mt-3 ${SECTION_TITLE_CLASS} text-balance`}>{t(k("whereTitle"))}</p>
        </div>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-start">
            <thead>
              <tr className="border-b border-border text-xs tracking-wide text-muted uppercase">
                <th scope="col" className="py-2.5 pe-3 text-start font-medium">
                  {t(k("whereHeaders.record"))}
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-medium">
                  {t(k("whereHeaders.who"))}
                </th>
                <th scope="col" className="py-2.5 text-start font-medium">
                  {t(k("whereHeaders.sees"))}
                </th>
              </tr>
            </thead>
            <tbody>
              {WHERE_ROWS.map((row) => (
                <tr key={row} className="border-b border-border align-top">
                  <th scope="row" className="py-3.5 pe-3 text-start font-semibold">
                    {t(k(`where.${row}.record`))}
                  </th>
                  <td className="py-3.5 pe-3 text-muted">{t(k(`where.${row}.who`))}</td>
                  <td className="py-3.5">{t(k(`where.${row}.sees`))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <Eyebrow as="h3">{t(k("staysEyebrow"))}</Eyebrow>
            <p className={`mt-3 ${SECTION_TITLE_CLASS} text-balance`}>{t(k("staysTitle"))}</p>
            <p className="mt-3 text-lg leading-8 text-muted">{t(k("staysBody"))}</p>
          </div>
          <div>
            <Eyebrow as="h3">{t(k("movingEyebrow"))}</Eyebrow>
            <p className={`mt-3 ${SECTION_TITLE_CLASS} text-balance`}>{t(k("movingTitle"))}</p>
            <p className="mt-3 text-lg leading-8 text-muted">{t(k("movingBody"))}</p>
            <Link
              href={switchingHref("/switching", "product-one-list")}
              className={buttonClass({
                variant: "link",
                flush: true,
                className: "mt-2 text-start",
              })}
            >
              {t(k("movingLink"))}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({
  name,
  detail,
  children,
}: {
  name: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3">
      <div>
        {/* i18n-exempt: sample diver name used only in marketing mockups */}
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
      <p className="flex flex-wrap gap-1.5">{children}</p>
    </div>
  );
}
