/**
 * Types shared between the WhatsApp settings page (server) and its Embedded
 * Signup launcher (client), kept in their own module the same way the calendar
 * panel's `feed-panel-types.ts` is.
 *
 * Separate file, not an export from the `.tsx`: staff copy is server-side only
 * (AGENTS.md), so a Client Component takes its words as props — and keeping
 * those prop shapes here leaves the component file as markup and behaviour.
 */

/** Words the launcher renders, resolved on the server. */
export type SignupCopy = {
  connect: string;
  connecting: string;
  cancelled: string;
  blocked: string;
};

/** The slice of the Facebook JS SDK the launcher calls. */
export type FacebookSdk = {
  init(options: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ): void;
};

/** The server action the launcher submits its three hidden fields to. */
export type SignupAction = (formData: FormData) => void | Promise<void>;
