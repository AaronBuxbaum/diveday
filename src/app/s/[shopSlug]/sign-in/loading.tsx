import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";

/** The sign-in page's skeleton: its narrow column, the header, one field and the button. */
export default function DiverSignInLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Pending>
        <ShopPageHeader
          pending
          eyebrow={false}
          titleWidth="w-32"
          description
          descriptionWidth="w-80 max-w-full"
        />
        <div className="flex flex-col gap-4">
          <Bone className="h-5 w-16" />
          <Bone shape="control" className="h-11" />
          <Bone shape="control" className="h-11 w-40" />
        </div>
      </Pending>
    </main>
  );
}
