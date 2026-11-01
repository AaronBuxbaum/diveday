import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";

describe("identical count templates preserve localized number output", () => {
  for (const locale of ["en-US", "es-ES"] as const) {
    for (const count of [0, 1, 2, 1000, 1_234_567, 1.5]) {
      it(`formats ${locale} count ${count} in the same locale as the message`, () => {
        const t = staffTranslator(locale);
        const previous = createTranslator({
          locale,
          messages: {
            trips: {
              whoWantsIn: {
                showMore:
                  locale === "en-US"
                    ? "{count, plural, one {Show # more} other {Show # more}}"
                    : "{count, plural, one {Ver # más} other {Ver # más}}",
              },
            },
            workOrders: {
              diver: {
                onTheBench:
                  locale === "en-US"
                    ? "{count, plural, one {# on the bench} other {# on the bench}}"
                    : "{count, plural, one {# en el taller} other {# en el taller}}",
              },
            },
          },
        });
        const number = new Intl.NumberFormat(locale).format(count);

        const showMore = t("trips.whoWantsIn.showMore", { count });
        const onTheBench = t("workOrders.diver.onTheBench", { count });
        expect(showMore).toBe(previous("trips.whoWantsIn.showMore", { count }));
        expect(onTheBench).toBe(previous("workOrders.diver.onTheBench", { count }));
        expect(showMore).toBe(
          `${locale === "en-US" ? "Show" : "Ver"} ${number} ${locale === "en-US" ? "more" : "más"}`,
        );
        expect(onTheBench).toBe(
          `${number} ${locale === "en-US" ? "on the bench" : "en el taller"}`,
        );
      });
    }
  }
});
