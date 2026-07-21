import type { Metadata } from "next";
import Link from "next/link";
import { onboardAction } from "@/app/actions/onboard";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";

export const metadata: Metadata = {
  title: "Onboard your Shop — DiveDay",
};

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-full flex-col">
      <MarketingNav />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-12 sm:py-24">
        <div className="rounded-lg border border-border bg-surface p-6 sm:p-8 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight">Onboard your shop</h1>
          <p className="mt-1.5 text-sm text-muted">
            Create a new tenant shop and owner profile to get started.
          </p>

          {error ? (
            <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {decodeURIComponent(error)}
            </p>
          ) : null}

          <form action={onboardAction} className="mt-6 flex flex-col gap-5">
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold border-b border-border pb-1">Shop Details</h2>
              <FieldGrid columns={2}>
                <Field label="Shop Name">
                  <input
                    name="shopName"
                    type="text"
                    required
                    placeholder="e.g. Green Lagoon Divers"
                    className={`${controlClass} focus:outline-none`}
                  />
                </Field>
                <Field label="URL Slug">
                  <input
                    name="shopSlug"
                    type="text"
                    required
                    placeholder="e.g. green-lagoon"
                    pattern="^[a-z0-9-]+$"
                    title="Only lowercase letters, numbers, and hyphens allowed"
                    className={`${controlClass} focus:outline-none`}
                  />
                </Field>
              </FieldGrid>
              <FieldGrid columns={1}>
                <Field label="Timezone">
                  <select
                    name="timezone"
                    required
                    defaultValue="America/New_York"
                    className={`${controlClass} focus:outline-none`}
                  >
                    <option value="America/New_York">Eastern Time (New York)</option>
                    <option value="America/Chicago">Central Time (Chicago)</option>
                    <option value="America/Denver">Mountain Time (Denver)</option>
                    <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
                    <option value="Europe/London">London</option>
                    <option value="Asia/Singapore">Singapore</option>
                    <option value="Australia/Sydney">Sydney</option>
                    <option value="Pacific/Auckland">Auckland</option>
                  </select>
                </Field>
              </FieldGrid>
            </section>

            <section className="flex flex-col gap-4 mt-2">
              <h2 className="text-lg font-semibold border-b border-border pb-1">Owner Profile</h2>
              <FieldGrid columns={1}>
                <Field label="Full Name">
                  <input
                    name="ownerName"
                    type="text"
                    required
                    placeholder="e.g. Dana Reyes"
                    className={`${controlClass} focus:outline-none`}
                  />
                </Field>
              </FieldGrid>
              <FieldGrid columns={2}>
                <Field label="Email Address">
                  <input
                    name="ownerEmail"
                    type="email"
                    required
                    placeholder="e.g. owner@example.com"
                    className={`${controlClass} focus:outline-none`}
                  />
                </Field>
                <Field label="Password">
                  <input
                    name="ownerPassword"
                    type="password"
                    required
                    placeholder="At least 6 characters"
                    minLength={6}
                    className={`${controlClass} focus:outline-none`}
                  />
                </Field>
              </FieldGrid>
            </section>

            <div className="mt-2 rounded-lg border border-accent/30 bg-accent/5 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  name="seedDemoData"
                  type="checkbox"
                  defaultChecked
                  className="mt-1 h-4 w-4 rounded border-border-strong text-primary focus:ring-primary"
                />
                <div>
                  <span className="text-sm font-medium text-foreground">Seed with demo data</span>
                  <p className="text-xs text-muted mt-0.5">
                    Pre-populate your shop schedule with trips, bookings, rental fit, nitrox cards,
                    and customers. Recommended for a hands-on trial.
                  </p>
                </div>
              </label>
            </div>

            <SubmitButton
              pendingLabel="Setting up your shop..."
              className={buttonClass({
                className: "mt-2 cursor-pointer focus:outline-none",
              })}
            >
              Create shop & start trial
            </SubmitButton>
          </form>

          <p className="text-center text-sm text-muted mt-6">
            Already have a shop?{" "}
            <Link href="/sign-in" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
