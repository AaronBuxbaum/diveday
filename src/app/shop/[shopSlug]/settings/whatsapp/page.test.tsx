import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionCard } from "@/components/ui/card";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { STAFF_MESSAGES } from "@/i18n/staff-messages";
import type { DiveDaySession } from "@/lib/auth";
import { seededTestDb } from "@/test/db";
import { findElements } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

// Same mocking shape as ../team/page.test.tsx: the page is invoked directly,
// outside Next's request scope, so the db handle, better-auth and request
// headers are stubbed and nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const WhatsAppSettingsPage = (await import("./page")).default;

const STATUS = STAFF_MESSAGES["en-US"].whatsapp.status;

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderWhatsApp() {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      name: "Dana Reyes",
      email: SEEDED_OWNER_EMAIL,
      roles: ["owner", "manager"],
    },
  });
  return WhatsAppSettingsPage({
    params: Promise.resolve({ shopSlug: "blue-mantis" }),
    searchParams: Promise.resolve({}),
  });
}

type CardProps = { title?: unknown; description?: unknown; children?: unknown };

async function statusCard() {
  const [card] = findElements<CardProps>(await renderWhatsApp(), SectionCard);
  expect(card?.props.title).toBe(STATUS.notConnectedHeading);
  return card as ReactElement<CardProps>;
}

/**
 * **The status sentence sits where every card's sentence sits** (K-315). With
 * no number connected it was the card's body, behind `SectionCard`'s `mt-4`,
 * so it stood 28px under its title where the security and team cards' own
 * sentences stand 15px (`description`, `mt-1`). It is the card's description
 * now, and the disabled Connect button is the body without a `mt-5` of its own.
 */
describe("the WhatsApp status card with no number connected", () => {
  it("says it is coming in the card's description, and holds only the disabled button", async () => {
    vi.stubEnv("META_APP_ID", "");
    const card = await statusCard();
    expect(card.props.description).toBe(STATUS.unavailableDescription);
    const body = [card.props.children].flat(Number.POSITIVE_INFINITY).filter(Boolean);
    expect(body).toHaveLength(1);
    const button = body[0] as ReactElement<{ disabled?: boolean }>;
    expect(button.type).toBe("button");
    expect(button.props.disabled).toBe(true);
  });

  it("says reminders go out as SMS in the description, with nothing under it, once connecting is open", async () => {
    vi.stubEnv("META_APP_ID", "app");
    vi.stubEnv("META_APP_SECRET", "secret");
    vi.stubEnv("META_WHATSAPP_SIGNUP_CONFIG_ID", "config");
    const card = await statusCard();
    expect(card.props.description).toBe(STATUS.notConnectedDescription);
    expect([card.props.children].flat(Number.POSITIVE_INFINITY).filter(Boolean)).toEqual([]);
  });
});
