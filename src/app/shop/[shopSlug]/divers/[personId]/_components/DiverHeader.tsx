import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { savePersonAction } from "../actions";
import type { DiverProfile, Shop } from "./shared";

export function DiverHeader({
  shop,
  diver,
  shopSlug,
  personId,
}: {
  shop: Shop;
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
}) {
  return (
    <>
      <Link
        href={`/shop/${shopSlug}/divers`}
        className="text-sm font-medium text-primary hover:underline"
      >
        ← All divers
      </Link>
      <header className="mt-4 flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{diver.person.fullName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {diver.person.email ? (
              <a
                href={`mailto:${diver.person.email}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 font-medium text-primary hover:bg-primary/10 hover:underline"
              >
                <span aria-hidden="true">✉</span>
                {diver.person.email}
              </a>
            ) : null}
            {diver.person.phone ? (
              <a
                href={`tel:${diver.person.phone.replace(/[^\d+]/g, "")}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 font-medium text-primary hover:bg-primary/10 hover:underline"
              >
                <span aria-hidden="true">☎</span>
                {diver.person.phone}
              </a>
            ) : null}
            {!diver.person.email && !diver.person.phone ? (
              <span>No contact details yet</span>
            ) : null}
          </div>
        </div>
        <details className="rounded-lg border border-border bg-surface px-4 py-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
            Edit details
          </summary>
          <FieldGrid
            as="form"
            action={savePersonAction.bind(null, shopSlug, personId)}
            columns={1}
            className="mt-4 gap-y-3 sm:w-80"
          >
            <Field label="Full name">
              <input
                name="fullName"
                required
                defaultValue={diver.person.fullName}
                className={controlClass}
              />
            </Field>
            <Field label="Email">
              <input
                name="email"
                type="email"
                defaultValue={diver.person.email ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label="Phone">
              <input
                name="phone"
                type="tel"
                defaultValue={diver.person.phone ?? ""}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton pendingLabel="Saving…" className={buttonClass()}>
                Save details
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </details>
      </header>
    </>
  );
}
