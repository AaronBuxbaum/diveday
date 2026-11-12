import Image from "next/image";
import { GroupLabel } from "@/components/ui/group-label";
import { diverTranslator } from "@/i18n/messages";
import type { PublicStaffProfile } from "@/lib/public-staff-profile";

/** One introduction, written by the person beside their pictures; no internal keys reach Flight. */
export function PublicStaffProfiles({
  profiles,
  locale,
}: {
  profiles: readonly PublicStaffProfile[];
  locale: string;
}) {
  if (profiles.length === 0) return null;
  const t = diverTranslator(locale);
  return (
    <section className="mt-8 print:hidden">
      <GroupLabel as="h2">{t("staffProfiles.heading")}</GroupLabel>
      <ul className="mt-4 grid gap-8 sm:grid-cols-2">
        {profiles.map((profile, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an internal person identifier must never be serialized publicly.
          <li key={index} className="min-w-0 space-y-3">
            {profile.photoUrls.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto">
                {profile.photoUrls.map((url) => (
                  <Image
                    key={url}
                    src={url}
                    alt=""
                    width={144}
                    height={144}
                    className="h-36 w-36 shrink-0 rounded-lg object-cover"
                  />
                ))}
              </div>
            ) : null}
            <div>
              <p className="font-medium">
                {profile.firstName}
                {profile.role ? ` · ${profile.role}` : ""}
              </p>
              {profile.sinceYear ? (
                <p className="text-sm text-muted">
                  {t("staffProfiles.since", { year: profile.sinceYear })}
                </p>
              ) : null}
              {profile.languages ? <p className="text-sm text-muted">{profile.languages}</p> : null}
            </div>
            {profile.description ? (
              <p className="whitespace-pre-line text-sm">{profile.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
