import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Display face for large statements only (hero headlines, section titles,
 * big numbers) — a tighter, more geometric face than Geist Sans, used
 * sparingly so it reads as an intentional editorial choice rather than a
 * whole second typeface running through the product. */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: "BRIX — Tokenized stocks, built for BNB Chain",
  description: "Discover, analyze, and buy tokenized stocks on BNB Chain, then protect your position over the weekend.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
