import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import type { CertificationLevel } from "@/lib/certification-levels";
import { canonicalAgency } from "@/lib/courses";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { courseCertifiedText } from "@/lib/notifications/course-certified";
import { type CourtesyProvider, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import {
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import { publicCoursePath } from "@/lib/public-routes";
import type { AppDb } from "./client";
import { notificationProviderForDb, sendNotification } from "./notifications";
import { certificationAgency, courses, people, shops, trips } from "./schema";
import { stopListedSmsProvider } from "./sms-opt-outs";
import { liveTrip, notRehearsal } from "./trips-live";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

/**
 * **Becoming certified is told to the student** (third UX review, item 14).
 *
 * The instructor's Certify tap writes a verified level card; until now the
 * student learned of it from a recap sentence, if the tap came before the
 * recap went out, and otherwise from nobody. This sends one message in the
 * Logbook register by the diver's usual channel (email, else the courtesy
 * text), with the shop's next public course on from this level when it has
 * one. Called only for a card the tap actually wrote, so a second tap on a
 * level the diver already holds sends nothing.
 *
 * Best-effort and never thrown at the caller: the card is the record, and a
 * mail provider being down must not turn a certification into an error.
 * Codes, never sentences.
 */
export type CourseCertifiedOutcome = "sent" | "no_contact" | "not_sent" | "skipped";

export type CourseCertifiedProviders = {
  emailProvider?: NotificationProvider;
  smsProvider?: SmsProvider;
  whatsAppProviders?: Map<string, CourtesyProvider>;
  /** Origin for the next-course link; defaults to the configured public app URL. */
  appOrigin?: string | null;
};

/**
 * The shop's next course on from `level`: active, not a taster, gated on
 * exactly this rung, the issuing course's agency first. Null when the shop
 * teaches nothing past it, which is most of the ladder's top.
 */
async function nextCourseAfter(
  db: AppDb,
  shopId: string,
  level: CertificationLevel,
  agency: string | null,
): Promise<{ title: string; slug: string } | null> {
  const sameAgency = agency
    ? sql`case when lower(trim(${courses.agency})) = ${canonicalAgency(agency)} then 0 else 1 end`
    : sql`0`;
  const [row] = await db
    .select({ title: courses.title, slug: courses.slug })
    .from(courses)
    .where(
      and(
        eq(courses.shopId, shopId),
        eq(courses.isActive, true),
        eq(courses.isIntroCourse, false),
        eq(courses.minimumCertificationLevel, level),
      ),
    )
    .orderBy(sameAgency, asc(courses.title))
    .limit(1);
  return row ?? null;
}

export async function tellCourseCertified(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    tripId: string;
    certificationId: string;
    level: CertificationLevel;
    recordedAt: Date;
  },
  providers: CourseCertifiedProviders = {},
): Promise<CourseCertifiedOutcome> {
  const [row] = await db
    .select({ shop: shops, person: people, courseId: trips.courseId })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .innerJoin(people, and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.shopId, input.shopId),
        liveTrip(),
        // A practice departure certifies nobody real (ADR 20261012-rehearsal-departures).
        notRehearsal(),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return "skipped";
  const { shop, person } = row;
  const phone = person.email ? null : smsRecipient(person.phone);
  if (!person.email && !phone) return "no_contact";

  const locale = recipientLocale(person.locale, shop.defaultLocale);
  const [issuing] = row.courseId
    ? await db
        .select({ agency: courses.agency })
        .from(courses)
        .where(and(eq(courses.id, row.courseId), eq(courses.shopId, shop.id)))
        .limit(1)
    : [];
  const next = await nextCourseAfter(db, shop.id, input.level, issuing?.agency ?? null);
  // The card's issuer, named in the message only when it is one we know.
  const agency = certificationAgency.enumValues.find((value) => value === issuing?.agency);
  const origin = providers.appOrigin === undefined ? publicAppUrl() : providers.appOrigin;
  const nextCourse =
    next && origin
      ? {
          title: next.title,
          url: new URL(publicCoursePath(shop.slug, next.slug), `${origin}/`).toString(),
        }
      : undefined;

  try {
    if (person.email) {
      const delivery = await sendNotification(
        db,
        {
          kind: "course_certified",
          certificationId: input.certificationId,
          shopId: shop.id,
          to: person.email,
          locale,
          diverName: person.fullName,
          shopName: shop.name,
          level: input.level,
          ...(agency ? { agency } : {}),
          recordedAt: input.recordedAt,
          timezone: shop.timezone,
          ...(nextCourse ? { nextCourse } : {}),
        },
        notificationProviderForDb(providers.emailProvider),
      );
      return delivery.status === "sent" ? "sent" : "not_sent";
    }
    if (!phone) return "no_contact";
    const senders = providers.whatsAppProviders ?? (await whatsAppProvidersForShops(db, [shop.id]));
    const sms = stopListedSmsProvider(db, providers.smsProvider ?? smsProviderFromEnvironment());
    const t = diverTranslator(locale);
    const sent = await sendCourtesyMessage(
      {
        to: phone,
        body: courseCertifiedText({ locale, shopName: shop.name, level: input.level }),
        smsStopLine: t("notifications.sms.stopLine"),
        shopName: shop.name,
      },
      { sms, whatsapp: senders.get(shop.id) ?? null },
    );
    return sent.delivery.status === "sent" ? "sent" : "not_sent";
  } catch {
    return "not_sent";
  }
}
