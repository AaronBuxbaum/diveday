import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  copyDiveSite,
  deleteDiveSite,
  getDiveSite,
  listDiveSites,
  updateDiveSite,
} from "@/db/dive-sites";
import { splitMediaUrls } from "@/lib/dive-sites";
import { CERTIFICATION_LEVEL_LABELS, SPECIALTY_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Edit dive site — Scuba" };

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

export default async function EditDiveSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id } = await params;
  const { notice, error } = await searchParams;
  const back = `/shop/${shopSlug}/dive-sites`;
  const db = await getDb();
  const site = await getDiveSite(db, session.user.shopId, id);
  if (!site) notFound();

  async function saveAction(formData: FormData) {
    "use server";
    const activeSession = await requireStaffSession();
    const parsed = siteSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}/${id}?error=invalid`);
    const specialties = z
      .array(specialtySchema)
      .safeParse(formData.getAll("specialty").map(String));
    if (!specialties.success) redirect(`${back}/${id}?error=invalid`);
    let imageUrls: string[];
    try {
      imageUrls = splitMediaUrls(parsed.data.imageUrls);
    } catch {
      redirect(`${back}/${id}?error=images`);
    }
    const landmarks = parsed.data.landmarks
      .split("\n")
      .map((landmark) => landmark.trim())
      .filter(Boolean);
    const updated = await updateDiveSite(await getDb(), activeSession.user.shopId, id, {
      shopId: activeSession.user.shopId,
      ...parsed.data,
      forecastLatitude: parsed.data.forecastLatitude === "" ? null : parsed.data.forecastLatitude,
      forecastLongitude:
        parsed.data.forecastLongitude === "" ? null : parsed.data.forecastLongitude,
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
    if (!updated) notFound();
    redirect(`${back}/${id}?notice=saved`);
  }

  async function copyAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const activeDb = await getDb();
    const names = new Set(
      (await listDiveSites(activeDb, activeSession.user.shopId)).map((entry) => entry.name),
    );
    let copyName = `${site.name} copy`;
    let number = 2;
    while (names.has(copyName)) copyName = `${site.name} copy ${number++}`;
    const copy = await copyDiveSite(activeDb, activeSession.user.shopId, id, copyName);
    if (!copy) notFound();
    redirect(`${back}/${copy.id}?notice=copied`);
  }

  async function deleteAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const deleted = await deleteDiveSite(await getDb(), activeSession.user.shopId, id);
    redirect(deleted ? `${back}?notice=archived` : `${back}/${id}?error=invalid`);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        ← Dive-site library
      </Link>
      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{site.name}</h1>
          <p className="mt-1 text-muted">Changes update the briefing linked to this site.</p>
        </div>
        <form action={copyAction}>
          <button
            type="submit"
            className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
          >
            Copy and tailor
          </button>
        </form>
        <details className="w-full sm:w-auto">
          <summary className="flex min-h-11 cursor-pointer items-center rounded-lg border border-danger/30 px-4 py-2 text-center text-sm font-medium text-danger">
            Archive site
          </summary>
          <form
            action={deleteAction}
            className="mt-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm sm:w-72"
          >
            <p className="text-muted">
              Historical trips keep their briefing; new trips will no longer see this site.
            </p>
            <button
              type="submit"
              className="mt-3 min-h-11 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Archive briefing
            </button>
          </form>
        </details>
      </header>
      {notice ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success"
        >
          {notice === "copied" ? "Independent copy ready to tailor." : "Site briefing saved."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error === "images"
            ? "Use up to six complete HTTP(S) image links, one per line."
            : "That didn’t save. Check the name and links, then try again."}
        </p>
      ) : null}
      <form action={saveAction} className="mt-8 flex flex-col gap-5">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={site.name}
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
                defaultValue={site.forecastLatitude ?? ""}
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
                defaultValue={site.forecastLongitude ?? ""}
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
            defaultValue={site.locationName ?? ""}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          What makes this site special?
          <textarea
            name="description"
            rows={3}
            maxLength={1200}
            defaultValue={site.description ?? ""}
            className={inputClass}
          />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Satellite map image URL
            <textarea
              name="satelliteImageUrl"
              rows={2}
              defaultValue={site.satelliteImageUrl ?? ""}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Route image URL <span className="font-normal text-muted">(optional)</span>
            <textarea
              name="routeImageUrl"
              rows={2}
              defaultValue={site.routeImageUrl ?? ""}
              className={inputClass}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Site photo URLs <span className="font-normal text-muted">(one per line, up to six)</span>
          <textarea
            name="imageUrls"
            rows={4}
            defaultValue={site.imageUrls.join("\n")}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          What might divers see?
          <input
            name="marineLife"
            maxLength={400}
            defaultValue={site.marineLife ?? ""}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Underwater briefing
          <textarea
            name="marineLifeDescription"
            rows={3}
            maxLength={1200}
            defaultValue={site.marineLifeDescription ?? ""}
            className={inputClass}
          />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Difficulty <span className="font-normal text-muted">(optional)</span>
            <input
              name="difficulty"
              maxLength={120}
              defaultValue={site.difficulty ?? ""}
              placeholder="Calm, intermediate, advanced"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Depth range <span className="font-normal text-muted">(optional)</span>
            <input
              name="depthRange"
              maxLength={120}
              defaultValue={site.depthRange ?? ""}
              placeholder="20–45 ft"
              className={inputClass}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Current and conditions notes <span className="font-normal text-muted">(optional)</span>
          <textarea
            name="currentNote"
            rows={2}
            maxLength={500}
            defaultValue={site.currentNote ?? ""}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Dive plan <span className="font-normal text-muted">(optional)</span>
          <textarea
            name="divePlan"
            rows={3}
            maxLength={1200}
            defaultValue={site.divePlan ?? ""}
            placeholder="Entry, route, turnaround, and exit notes."
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Landmarks <span className="font-normal text-muted">(one per line, optional)</span>
          <textarea
            name="landmarks"
            rows={3}
            maxLength={4000}
            defaultValue={site.landmarks.join("\n")}
            className={inputClass}
          />
        </label>
        <fieldset className="rounded-lg border border-border bg-surface-sunken p-5">
          <legend className="px-1 text-sm font-medium">Certification requirements</legend>
          <p className="text-sm text-muted">
            The site's own gate. Every trip that visits this site enforces at least this — the
            readiness service takes the stricter of the site and the trip.
          </p>
          <label className="mt-4 flex flex-col gap-1 text-sm font-medium">
            Minimum certification
            <select
              name="minimumCertificationLevel"
              defaultValue={site.minimumCertificationLevel ?? ""}
              className={inputClass}
            >
              <option value="">No level required by the site</option>
              {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-4">
            <p className="text-sm font-medium">Required specialties</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(SPECIALTY_LABELS).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input
                    name="specialty"
                    type="checkbox"
                    value={value}
                    defaultChecked={site.requiredSpecialties.includes(
                      value as keyof typeof SPECIALTY_LABELS,
                    )}
                    className="size-4 accent-primary"
                  />
                  {label}
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  name="requiresNitrox"
                  type="checkbox"
                  defaultChecked={site.requiresNitrox}
                  className="size-4 accent-primary"
                />
                Nitrox
              </label>
            </div>
          </div>
        </fieldset>
        <button
          type="submit"
          className="mt-2 min-h-11 self-start rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
        >
          Save briefing
        </button>
      </form>
    </main>
  );
}
