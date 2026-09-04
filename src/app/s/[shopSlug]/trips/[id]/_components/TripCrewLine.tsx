import type { PublicCrewMember } from "@/db/trips";
import { languageNameIn } from "@/i18n/language-labels";
import { diverTranslator } from "@/i18n/messages";
import { cachedListFormat } from "@/lib/intl-cache";

/**
 * **The people, not a faceless crew label** (issue #1181, delight report D21).
 *
 * The page has always been able to say *"we speak German"* — an aggregate that
 * names nobody, which is what `ConditionsLine`'s own docblock calls the
 * anonymous claim a shop may make about its staff. This is the other thing a
 * diver wants to know before a boat: who they are actually going out with.
 *
 * **Every name here is that person's own decision.** `tripPublicCrew` filters
 * to `crew_public_consent_at`, which only the person themselves can write
 * (`saveCrewPublicConsentAction`, on the staffing page beside their own
 * blackouts). A shop that has switched nothing on renders nothing at all, and
 * so does a departure whose crew have not — which is why this returns null
 * rather than an empty heading.
 *
 * **Role, first name, languages, and nothing else.** No surname, no photo, no
 * biography: D21's boundary is exactly those three facts, and a photo is
 * optional in a feature nobody has asked for and never required by an
 * operational record.
 */
export function TripCrewLine({
  crew,
  locale,
  className = "",
}: {
  crew: readonly PublicCrewMember[];
  locale: string;
  className?: string;
}) {
  if (crew.length === 0) return null;
  const t = diverTranslator(locale);
  return (
    <section className={`mt-6 ${className}`}>
      <h2 className="text-sm font-semibold">{t("trip.crewHeading")}</h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
        {crew.map((member) => {
          const languages = member.languages
            .map((language) => languageNameIn(language, locale) ?? language)
            .filter(Boolean);
          return (
            <li key={member.personId}>
              <span className="font-medium text-foreground">{member.firstName}</span>
              {member.tripRole ? ` · ${t(`trip.crewRole.${member.tripRole}`)}` : ""}
              {/* The languages are the reason a diver reads this line at all,
                  so they are stated even when the roster left the job blank. */}
              {languages.length > 0
                ? ` · ${cachedListFormat(locale, { style: "long", type: "conjunction" }).format(languages)}`
                : ""}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
