import { ShopPageHeaderSkeleton, SkeletonLineBars } from "@/components/ShopPageHeader";

/**
 * One `Field` as bars, in the field's own boxes: the caption's 20px `text-sm`
 * line, the 4px row gap, the 44px `controlClass` box, and — for a field with a
 * `description` — the 4px gap and its 16px `text-xs` line.
 */
function FieldBars({ label, description = false }: { label: string; description?: boolean }) {
  return (
    <div>
      <div className="flex h-5 items-center">
        <div className={`h-3.5 ${label} rounded bg-surface-sunken`} />
      </div>
      <div data-control-bar className="mt-1 h-11 rounded-lg border border-border bg-surface" />
      {description ? <div className="mt-1 h-4 w-64 max-w-full rounded bg-surface-sunken" /> : null}
    </div>
  );
}

/**
 * A `<fieldset>` of `RegisterForm` as bars: the `LEAD_TITLE_CLASS` legend's
 * 32px line, its `mt-1 mb-4` hint (two lines on a phone, one from `sm`), then
 * the fields on `FieldGrid`'s own gutters.
 */
function GroupBars({
  legend,
  columns,
  fields,
}: {
  legend: string;
  columns: string;
  fields: string[];
}) {
  return (
    <div>
      <div data-legend-bar className={`h-8 ${legend} rounded bg-surface-sunken`} />
      <div className="mt-1 mb-4">
        <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-5" width="w-full" />
      </div>
      <div className={`grid grid-cols-1 gap-x-4 gap-y-4 ${columns}`}>
        {fields.map((label, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records — the position is the only identity a placeholder field has
          <FieldBars key={index} label={label} />
        ))}
      </div>
    </div>
  );
}

/**
 * The register page's own Suspense boundary — body-shaped, so a client
 * navigation into the segment paints the form's frame rather than a spinner
 * (ADR 20260804-instant-navigation).
 *
 * **Drawn from the form, box for box** (pixel-craft class 11, K-384). It
 * predated `RegisterForm`'s two legend groups — six fields in one grid under a
 * 36px title bar, and a pill for the submit — so every field below the first
 * row arrived lower than its grey box. It now stands the header's own lines
 * (`ShopPageHeaderSkeleton`: no eyebrow; the title two lines on a phone, the
 * intro three, one and two from `sm`), then the form's `gap-8` column: the
 * contact fields (the email's hint under its box), the certification group,
 * the sizes group, and the `md` submit's 48px. `loading.test.tsx` reads the
 * form's control and legend counts off its source.
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 animate-pulse px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeaderSkeleton
        eyebrow={false}
        titleWidth="w-full sm:w-4/5"
        titleLines={{ base: 2, sm: 1 }}
        description
        descriptionWidth="w-full"
        descriptionLines={{ base: 3, sm: 2 }}
      />
      <div className="mt-8 flex flex-col gap-8">
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
          <FieldBars label="w-20" />
          <FieldBars label="w-12" description />
          <FieldBars label="w-14" />
        </div>
        <GroupBars legend="w-56" columns="sm:grid-cols-2" fields={["w-16", "w-12", "w-28"]} />
        <GroupBars legend="w-40" columns="sm:grid-cols-3" fields={["w-16", "w-12", "w-10"]} />
        <div data-submit-bar className="h-12 w-44 rounded-lg bg-surface-sunken" />
      </div>
    </main>
  );
}
