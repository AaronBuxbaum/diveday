import { redirect } from "next/navigation";
import { requireStaffSession } from "@/lib/session";

export default async function OrdersPage() {
  const session = await requireStaffSession();
  redirect(`/shop/${session.user.shopSlug}/divers`);
}
