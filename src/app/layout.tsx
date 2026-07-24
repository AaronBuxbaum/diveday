import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { publicAppUrl } from "@/lib/notifications";
import { Observability } from "./observability-client";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // The canonical origin comes from APP_HOST (the same source bearer-token
  // links use); localhost keeps relative-URL resolution working in dev/e2e.
  metadataBase: new URL(publicAppUrl() ?? "http://localhost:3000"),
  title: "DiveDay — a calmer way to run a dive day",
  description:
    "Bookings, waivers, cert checks, trip prep, and boat manifests — one calm system for the whole dive shop.",
  openGraph: {
    siteName: "DiveDay",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Observability />
      </body>
    </html>
  );
}
