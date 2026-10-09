import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { type OpenSetupLink, openSetupLink } from "@/db/setup-links";
import { SETUP_LINK_COOKIE, SETUP_LINK_PARAM } from "@/lib/setup-links";

/**
 * Which door `/onboard` draws for the setup link its URL carries (ADR
 * 20261009-single-use-setup-links).
 *
 * The link comes from the URL on arrival, and from the HttpOnly cookie a bounce
 * from the form carries it back in (`onboardAction`), so a correction never
 * writes the token into a `Location:` header.
 *
 * - **No link**: the closed door that says where to ask.
 * - **A link that does not open**: unknown, spent, expired, mistyped or
 *   repeated in the query string are one answer, "This setup link no longer
 *   works". The page never says which.
 * - **An open link**: the form, filled the first time with the request's own
 *   answers; a bounce back carries what was typed since, which wins.
 */
export type SetupLinkDoor =
  | { door: "none" }
  | { door: "spent" }
  | { door: "open"; token: string; link: OpenSetupLink };

export async function setupLinkDoor(
  fromUrl: string | string[] | undefined,
): Promise<SetupLinkDoor> {
  const setup = fromUrl ?? (await cookies()).get(SETUP_LINK_COOKIE)?.value;
  if (setup === undefined) return { door: "none" };
  const link = await openSetupLink(await getDb(), setup);
  if (!link || typeof setup !== "string") return { door: "spent" };
  return { door: "open", token: setup, link };
}

/** The open link's token, carried with the form so the action can spend it. */
export function SetupLinkField({ token }: { token: string }) {
  return <input type="hidden" name={SETUP_LINK_PARAM} value={token} />;
}
