import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";

/**
 * Body-shaped skeleton for the doctor's page (design principle 1): the shop
 * name, the title and its two-line lede, the print row, the question chips,
 * then the evaluation form's box.
 */
export default function DoctorReferralLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 flex flex-col gap-2">
          <div className="h-5 w-full rounded bg-surface-sunken" />
          <div className="h-5 w-2/3 rounded bg-surface-sunken" />
        </div>
        <div className="mt-6 h-11 w-40 rounded-lg bg-surface-sunken" />
        <div className="mt-8 h-7 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 flex gap-2">
          <div className="h-8 w-28 rounded-md bg-surface-sunken" />
          <div className="h-8 w-36 rounded-md bg-surface-sunken" />
        </div>
        <div className="mt-8 h-96 rounded-lg border border-border" />
      </div>
    </main>
  );
}
