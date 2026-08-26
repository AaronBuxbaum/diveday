import type { JSX } from "react";
import type { DiverTranslator } from "@/i18n/messages";
import {
  type ConservationCommitmentCode,
  conservationCommitmentLabel,
} from "@/lib/conservation-commitments";

function GreenFinsLogo(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4 shrink-0 text-primary"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      {/* Green Fins stylized fin & wave */}
      <path d="M6.5 16.5C7.5 13 10 9.5 14 7.5C11.5 10.5 10.5 14 11 16.5H6.5Z" fill="currentColor" />
      <path
        d="M11.5 16.5C12.5 12.5 15.5 9.5 19 8C16.5 11 15.5 14 16 16.5H11.5Z"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  );
}

function PadiAwareLogo(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4 shrink-0 text-primary"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7 13.5C8.5 10.5 11 9.5 12.5 11.5C14 13.5 16 12.5 17.5 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M6.5 16C8.5 13 11 13 13 14.5C15 16 16.5 15 18 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}

function MooringBuoyIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4 shrink-0 text-muted"
      aria-hidden="true"
    >
      <path
        d="M10 3V6M10 6C7.79 6 6 7.79 6 10C6 11.8 7.2 13.3 8.87 13.84L10 17L11.13 13.84C12.8 13.3 14 11.8 14 10C14 7.79 12.21 6 10 6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 14C5.5 13.5 8.5 13.5 10 14C11.5 14.5 14.5 14.5 16 14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NoTouchIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4 shrink-0 text-muted"
      aria-hidden="true"
    >
      <path
        d="M10 2C5.58 2 2 5.58 2 10C2 14.42 5.58 18 10 18C14.42 18 18 14.42 18 10C18 5.58 14.42 2 10 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M5 15L15 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M10 7C9.45 7 9 7.45 9 8V11C9 11.55 9.45 12 10 12C10.55 12 11 11.55 11 11V8C11 7.45 10.55 7 10 7Z"
        fill="currentColor"
      />
    </svg>
  );
}

function NoGlovesIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4 shrink-0 text-muted"
      aria-hidden="true"
    >
      <path
        d="M7 14V8C7 6.9 7.9 6 9 6C10.1 6 11 6.9 11 8V14M11 10C11 8.9 11.9 8 13 8C14.1 8 15 8.9 15 10V14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M4 16L16 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ReefCleanupIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4 shrink-0 text-muted"
      aria-hidden="true"
    >
      <path
        d="M3 6L10 13L17 6M6 10L10 14L14 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 3V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LionfishIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4 shrink-0 text-muted"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 5V8M10 12V15M5 10H8M12 10H15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CoralNurseryIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4 shrink-0 text-muted"
      aria-hidden="true"
    >
      <path
        d="M10 17V9M10 9C10 6 7 5 7 5M10 9C10 6 13 5 13 5M10 13C8 12 6 11 6 11M10 13C12 12 14 11 14 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function commitmentIcon(code: ConservationCommitmentCode): JSX.Element {
  switch (code) {
    case "green_fins_member":
      return <GreenFinsLogo />;
    case "padi_aware_partner":
      return <PadiAwareLogo />;
    case "mooring_buoys_only":
      return <MooringBuoyIcon />;
    case "no_touch_policy":
      return <NoTouchIcon />;
    case "no_gloves_policy":
      return <NoGlovesIcon />;
    case "reef_cleanup_dives":
      return <ReefCleanupIcon />;
    case "lionfish_containment":
      return <LionfishIcon />;
    case "coral_nursery_support":
      return <CoralNurseryIcon />;
  }
}

export function ConservationCommitmentBadge({
  code,
  t,
}: {
  code: ConservationCommitmentCode;
  t: DiverTranslator;
}): JSX.Element {
  const label = conservationCommitmentLabel(code, t);
  const isFeaturedPartner = code === "green_fins_member" || code === "padi_aware_partner";

  if (isFeaturedPartner) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs">
        {commitmentIcon(code)}
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-sunken px-3 py-1 text-xs font-medium text-foreground">
      {commitmentIcon(code)}
      <span>{label}</span>
    </span>
  );
}
