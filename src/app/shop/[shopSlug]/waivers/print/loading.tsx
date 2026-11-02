import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";

/**
 * The blank release's shape while it is read: the toolbar's two controls over
 * a page of release text, which is what the printed sheet opens with.
 */
export default function BlankReleaseLoading() {
  return (
    <StaffPage width="reading" className="animate-pulse">
      <div className="flex items-center justify-between gap-3">
        <div className="h-10 w-28 rounded-lg bg-surface-sunken" />
        <div className="h-12 w-28 rounded-lg bg-surface-sunken" />
      </div>
      <div className="mt-6 h-4 w-36 rounded bg-surface-sunken" />
      <div className="mt-4 space-y-3">
        {["a", "b", "c", "d", "e", "f"].map((row) => (
          <div key={row} className="h-4 w-full rounded bg-surface-sunken" />
        ))}
      </div>
    </StaffPage>
  );
}
