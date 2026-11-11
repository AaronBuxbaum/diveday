import Link from "next/link";
import { Eyebrow } from "@/app/_components/Eyebrow";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * **Why the roll call is by name**, under the home hero (Aaron, 2026-11-11).
 * The Lonergan story, cut to what the public record holds, then what the roll
 * call does, then a link to `/about`, which tells it in full. It keeps every
 * limit that page keeps: no operator or skipper named, and no sentence saying
 * DiveDay would have prevented it (`about/copy.test.ts` holds both tellings to
 * them, in both languages).
 */
export function HomeWhyBand({ t }: { t: DiverTranslator }) {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto w-full max-w-7xl px-6 py-14 lg:py-20">
        <div className="max-w-3xl">
          <Eyebrow as="h2">{t("marketing.home.whyEyebrow")}</Eyebrow>
          <p className="mt-4 text-xl leading-8 text-pretty sm:text-2xl sm:leading-9">
            {t("marketing.home.whyStory")}
          </p>
          <p className="mt-4 text-lg leading-8 text-pretty text-muted">
            {t("marketing.home.whyTie")}
          </p>
          <p className="mt-4">
            <Link
              href="/about"
              className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("marketing.home.whyLink")}
              <span aria-hidden="true">&nbsp;→</span>
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
