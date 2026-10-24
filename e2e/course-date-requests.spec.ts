import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { publicCoursePath } from "../src/lib/public-routes";
import { expect, makeActivitySafe, test } from "./fixtures";

const diver = diverTranslator("en-US");
const staff = staffTranslator("en-US");

// PADI Rescue Diver has a seeded future session; SDI Rescue is catalog-only.
const cases = [
  {
    name: "no sessions and no contact details",
    slug: "sdi-rescue-diver",
    phone: "",
    scheduled: false,
  },
  {
    name: "a scheduled session and no email",
    slug: "open-water-diver",
    phone: "",
    scheduled: true,
  },
  {
    name: "a phone-only shop",
    slug: "sdi-rescue-diver",
    phone: "+1 305 555 0134",
    scheduled: false,
  },
];

for (const scenario of cases) {
  test(`a signed-out diver requests a course date with ${scenario.name}`, async ({
    page,
    browser,
    workerBaseURL,
    privateShop,
  }) => {
    // Contact settings outlive a schedule reset, so each case owns its shop.
    await page.goto(`/shop/${privateShop.slug}/settings#contact`);
    await page.getByLabel(staff("settings.main.contact.emailLabel")).fill("");
    await page.getByLabel(staff("settings.main.contact.phoneLabel")).fill(scenario.phone);
    await page.getByRole("button", { name: staff("settings.main.contact.submit") }).click();
    await expect(
      page.getByText(staff("settings.main.notice.contactSaved"), { exact: true }),
    ).toBeVisible();

    const context = await browser.newContext({ baseURL: workerBaseURL });
    try {
      const publicPage = makeActivitySafe(await context.newPage());
      await publicPage.goto(publicCoursePath(privateShop.slug, scenario.slug));
      const inquiry = publicPage.getByRole("region", { name: diver("inquiry.askAboutCourse") });
      await expect(inquiry).toBeVisible();
      await expect(
        publicPage.getByRole("link", { name: diver("course.bookThisDate") }),
      ).toHaveCount(scenario.scheduled ? 1 : 0);
      if (!scenario.scheduled) {
        await expect(
          publicPage.getByRole("link", { name: diver("course.orAskUs") }),
        ).toHaveAttribute("href", "#get-in-touch");
      }
      if (scenario.phone) {
        await expect(inquiry.getByRole("link", { name: scenario.phone })).toHaveAttribute(
          "href",
          "tel:+13055550134",
        );
      }

      await inquiry.getByLabel(diver("inquiry.yourName")).fill("Ana Course Request");
      // No email on either side: this journey needs no email delivery at all.
      await inquiry.getByLabel(diver("inquiry.yourPhone")).fill("+1 305 555 0199");
      await inquiry.getByRole("button", { name: diver("inquiry.send"), exact: true }).click();
      await expect(inquiry.getByText(diver("inquiry.sentHeading"), { exact: true })).toBeVisible();

      await page.goto(`/shop/${privateShop.slug}/requests`);
      await expect(page.getByText("Ana Course Request", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "+1 305 555 0199" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
