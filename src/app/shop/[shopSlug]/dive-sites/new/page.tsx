import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createDiveSite } from "@/db/dive-sites";
import { splitMediaUrls } from "@/lib/dive-sites";
import { CERTIFICATION_LEVEL_LABELS, SPECIALTY_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Create dive site — Scuba" };

const optionalUrl = z.union([z.literal(""), z.url().max(2_000)]);
const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);
const siteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_200),
    locationName: z.string().trim().max(160),
    forecastLatitude: z.union([z.literal(""), z.coerce.number().min(-90).max(90)]),
    forecastLongitude: z.union([z.literal(""), z.coerce.number().min(-180).max(180)]),
    satelliteImageUrl: optionalUrl,
    routeImageUrl: optionalUrl,
    imageUrls: z.string().max(12_000),
    marineLife: z.string().trim().max(400),
    marineLifeDescription: z.string().trim().max(1_200),
    difficulty: z.string().trim().max(120),
    depthRange: z.string().trim().max(120),
    currentNote: z.string().trim().max(500),
    divePlan: z.string().trim().max(1_200),
    landmarks: z.string().max(4_000),
    minimumCertificationLevel: z.preprocess(
      (value) => (value === "" ? null : value),
      z
        .enum(["open_water", "advanced_open_water", "rescue", "divemaster", "instructor"])
        .nullable(),
    ),
  })
  .refine(
    (site) => (site.forecastLatitude === "") === (site.forecastLongitude === ""),
    "Add both forecast coordinates or leave both blank.",
  );

const inputClass =
  "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";

export default async function NewDiveSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireStaffSession();
  const { shopSlug } = await params;
  const { error } = await searchParams;
  const back = `/shop/${shopSlug}/dive-sites`;

  async function createAction(formData: FormData) {
    "use server";
    const activeSession = await requireStaffSession();
    const parsed = siteSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}/new?error=invalid`);
    let imageUrls: string[];
    try {
      imageUrls = splitMediaUrls(parsed.data.imageUrls);
    } catch {
      redirect(`${back}/new?error=images`);
    }
    const specialties = z
      .array(specialtySchema)
      .safeParse(formData.getAll("specialty").map(String));
    if (!specialties.success) redirect(`${back}/new?error=invalid`);
    const landmarks = parsed.data.landmarks
      .split("\n")
      .map((landmark) => landmark.trim())
      .filter(Boolean);
    const site = await createDiveSite(await getDb(), {
      shopId: activeSession.user.shopId,
      ...parsed.data,
      forecastLatitude:
        parsed.data.forecastLatitude === "" ? undefined : parsed.data.forecastLatitude,
      forecastLongitude:
        parsed.data.forecastLongitude === "" ? undefined : parsed.data.forecastLongitude,
      satelliteImageUrl: parsed.data.satelliteImageUrl || undefined,
      routeImageUrl: parsed.data.routeImageUrl || undefined,
      imageUrls,
      minimumCertificationLevel: parsed.data.minimumCertificationLevel,
      requiredSpecialties: specialties.data,
      requiresNitrox: formData.get("requiresNitrox") === "on",
      difficulty: parsed.data.difficulty,
      depthRange: parsed.data.depthRange,
      currentNote: parsed.data.currentNote,
      divePlan: parsed.data.divePlan,
      landmarks,
    });
    redirect(`${back}/${site.id}`);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        ← Dive-site library
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Build a dive-site briefing</h1>
      <p className="mt-1 text-muted">
        Everything is optional except the name. Keep it useful, vivid, and true to the site.
      </p>
      {error ? (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error === "images"
            ? "Use up to six complete HTTP(S) image links, one per line."
            : "That didn’t save. Check the required name and links, then try again."}
        </p>
      ) : null}
      <SiteForm action={createAction} inputClass={inputClass} submitLabel="Save site briefing" />
    </main>
  );
}

function SiteForm({
  action,
  inputClass,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  inputClass: string;
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-8 flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Name
        <input
          name="name"
          required
          maxLength={120}
          placeholder="Molasses Reef"
          className={inputClass}
        />
      </label>
      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">Automated marine forecast point</legend>
        <p className="mt-1 text-sm text-muted">
          Use the offshore dive point, not the shop address. Leave both blank to keep crew-only
          conditions.
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Latitude
            <input
              name="forecastLatitude"
              type="number"
              step="any"
              min={-90}
              max={90}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Longitude
            <input
              name="forecastLongitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              className={inputClass}
            />
          </label>
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Location <span className="font-normal text-muted">(optional)</span>
        <input
          name="locationName"
          maxLength={160}
          placeholder="Key Largo National Marine Sanctuary"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        What makes this site special?
        <textarea name="description" rows={3} maxLength={1200} className={inputClass} />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Satellite map image URL
          <textarea name="satelliteImageUrl" rows={2} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Route image URL <span className="font-normal text-muted">(optional)</span>
          <textarea name="routeImageUrl" rows={2} className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Site photo URLs <span className="font-normal text-muted">(one per line, up to six)</span>
        <textarea name="imageUrls" rows={4} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        What might divers see?
        <input
          name="marineLife"
          maxLength={400}
          placeholder="Parrotfish, eagle rays, elkhorn coral"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Underwater briefing
        <textarea name="marineLifeDescription" rows={3} maxLength={1200} className={inputClass} />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Difficulty <span className="font-normal text-muted">(optional)</span>
          <input
            name="difficulty"
            maxLength={120}
            placeholder="Calm, intermediate, advanced"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Depth range <span className="font-normal text-muted">(optional)</span>
          <input name="depthRange" maxLength={120} placeholder="20–45 ft" className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Current and conditions notes <span className="font-normal text-muted">(optional)</span>
        <textarea name="currentNote" rows={2} maxLength={500} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Dive plan <span className="font-normal text-muted">(optional)</span>
        <textarea
          name="divePlan"
          rows={3}
          maxLength={1200}
          placeholder="Entry, route, turnaround, and exit notes."
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Landmarks <span className="font-normal text-muted">(one per line, optional)</span>
        <textarea name="landmarks" rows={3} maxLength={4000} className={inputClass} />
      </label>
      <fieldset className="rounded-2xl border border-border bg-surface-sunken p-5">
        <legend className="px-1 text-sm font-medium">Readiness gates</legend>
        <p className="text-sm text-muted">
          These requirements travel with the site into every new trip that uses it.
        </p>
        <label className="mt-4 flex flex-col gap-1 text-sm font-medium">
          Minimum certification
          <select name="minimumCertificationLevel" defaultValue="" className={inputClass}>
            <option value="">No level required by the site</option>
            {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(SPECIALTY_LABELS).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                name="specialty"
                type="checkbox"
                value={value}
                className="size-4 accent-primary"
              />
              {label}
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input name="requiresNitrox" type="checkbox" className="size-4 accent-primary" />
            Nitrox
          </label>
        </div>
      </fieldset>
      <button
        type="submit"
        className="mt-2 min-h-11 self-start rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
      >
        {submitLabel}
      </button>
    </form>
  );
}
