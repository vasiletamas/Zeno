import type { Metadata } from "next";
import { Outfit, Fraunces } from "next/font/google";
import { LanguageProvider } from "@/lib/i18n/language-context";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin", "latin-ext"],
  variable: "--font-outfit",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["500"],
});

export const metadata: Metadata = {
  title: "Zeno — Pregătit pentru orice",
  description:
    "Asigurare de viață Allianz-Țiriac. Acces la tratament de top. Oriunde în lume.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro">
      <body
        className={`${outfit.variable} ${fraunces.variable} antialiased`}
      >
        <LanguageProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
