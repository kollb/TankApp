import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TankApp · Entscheidungs-Labor",
  description:
    "Jetzt tanken, heute Abend warten oder woanders hinfahren — und out-of-sample messen, ob die Entscheidung richtig war. Entscheidungs-Scoreboard statt Varianz-Graphen.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
