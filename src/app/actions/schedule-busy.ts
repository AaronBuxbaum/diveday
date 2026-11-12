import { redirect } from "next/navigation";
import { isLockWaitRefusal } from "@/db/lock-bounds";

/** A lock timeout changed nothing; return the caller to a retry notice. */
export function redirectOnScheduleBusy(error: unknown, retryUrl: string): never {
  if (isLockWaitRefusal(error)) redirect(retryUrl);
  throw error;
}
