import { SHOP_MAIN_CLASS } from "@/app/s/[shopSlug]/_components/shop-main";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * The medical questions' own skeleton (ADR 20260804-instant-navigation): the
 * header with its way back to the course and a two-line lede, then the ruled
 * list of questions, each a prompt and the muted line under it.
 */
const QUESTION_ROWS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"];

export default function CourseMedicalQuestionsLoading() {
  return (
    <main className={SHOP_MAIN_CLASS}>
      <Pending>
        <div className="max-w-2xl">
          <ShopPageHeader
            pending
            titleWidth="w-64 max-w-full"
            description
            descriptionWidth="w-full"
          />
          <div className="divide-y divide-border border-y border-border">
            {QUESTION_ROWS.map((row) => (
              <div key={row} className="space-y-2 py-3">
                <Bone className="h-5 w-full" />
                <Bone className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </Pending>
    </main>
  );
}
