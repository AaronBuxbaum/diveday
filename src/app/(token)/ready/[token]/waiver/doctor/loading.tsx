import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for the doctor's page (design principle 1): the shop
 * name, the title and its two-line lede, the print row, the official form's
 * box, then the answers section's date-of-birth field.
 */
export default function DoctorReferralLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <Pending>
        <Bone className="h-4 w-32" />
        <Bone className="mt-2 h-9 w-72 max-w-full" />
        <div className="mt-2 flex flex-col gap-2">
          <Bone className="h-5 w-full" />
          <Bone className="h-5 w-2/3" />
        </div>
        <Bone shape="control" className="mt-6 h-11 w-40" />
        <div className="mt-8 h-48 rounded-lg border border-border" />
        <Bone className="mt-8 h-7 w-64 max-w-full" />
        <Bone className="mt-3 h-5 w-full" />
        <Bone shape="control" className="mt-4 h-11 w-56" />
      </Pending>
    </main>
  );
}
