import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { canImportShopData } from "@/lib/authz";

/**
 * The other direction of the import/switching link (task 163): a switching
 * guide's "bring the file into DiveDay" step today only narrates opening
 * Settings → Import — a signed-in owner or manager reading it from their own
 * shop can jump straight there instead. `roles` comes from the stateless
 * session token (same source `isStaff` reads elsewhere on public pages); the
 * import page itself re-checks against the database and redirects away if
 * the role has since changed, so a stale token here only costs an extra
 * click, never a bypassed gate.
 */
export async function SwitchingImportCta({ label }: { label: string }) {
  const session = await auth();
  const shopSlug = session?.user?.shopSlug;
  if (!shopSlug || !canImportShopData(session.user.roles)) return null;
  return (
    <div className="mt-8">
      <Link
        href={`/shop/${shopSlug}/settings/import`}
        className={buttonClass({ variant: "secondary", className: "border-border-strong" })}
      >
        {label}
      </Link>
    </div>
  );
}
