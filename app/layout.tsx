import type { Metadata } from "next";
import { Inter, Fraunces, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["500"],
});

export const metadata: Metadata = {
  title: "Zeno — Pregatit pentru orice",
  description:
    "Asigurare de viata Allianz-Tiriac. Acces la tratament de top. Oriunde in lume.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro" className={cn("font-sans", geist.variable)}>
      <body
        className={`${inter.variable} ${fraunces.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
