import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TankApp — TankPuls v4 | Kalibriertes Tank-Entscheidungssystem",
  description:
    "Persönliche Tank-App mit mathematisch harter Selektion (Top-10 Quota 6/2/2), kalibrierter Konfidenz (ACI), Umweg-Ökonomie und direktem Entscheidungs-Kompass (Jetzt / Warten / Andere Station).",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
