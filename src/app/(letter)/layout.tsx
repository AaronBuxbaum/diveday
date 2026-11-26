import type { ReactNode } from "react";
import { ChromeBar } from "@/components/chrome/ChromeBar";
import { Wordmark } from "@/components/Logo";

/**
 * The header of `/hello`, the page the cold email links to: the wordmark and
 * nothing else (Aaron, 2026-11-26). The marketing nav's links and its demo
 * button pulled a reader who came to reply toward the page's third ask, so
 * this group draws the same bar as the marketing face with the menu left out.
 * It reads nothing per request, so it needs no streaming fallback.
 */
export default function LetterLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <ChromeBar wide leading={<Wordmark href="/" className="text-foreground" />} />
      {children}
    </div>
  );
}
