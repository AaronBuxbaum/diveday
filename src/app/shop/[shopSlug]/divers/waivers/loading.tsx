import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";

function LogRows({ count }: { count: number }) {
  return (
    <div className="mt-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static bars, no identity of their own
          key={index}
          className={ledgerRowBoxClass}
        >
          {/* A signature row as `SignatureLog` draws it: the summary's grammar,
              the departure on a full-width line at every width. */}
          <div className="flex min-h-12.75 flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <Bone className="my-1 h-4 min-w-0 flex-1" />
            <Bone className="order-last my-0.5 h-4 min-w-0 basis-full" />
            <Bone className="h-4 w-14 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The signed records' skeleton: the title, then the log as hairline day groups. */
export default function SignedWaiversLoading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending description={false} />
        <div className="mt-4 space-y-8">
          <div>
            <Bone className="h-4 w-28" />
            <LogRows count={3} />
          </div>
          <div>
            <Bone className="h-4 w-28" />
            <LogRows count={2} />
          </div>
        </div>
      </Pending>
    </StaffPage>
  );
}
