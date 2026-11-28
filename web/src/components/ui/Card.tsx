import type { HTMLAttributes, ReactNode } from "react";

export type CardTone = "go" | "wait" | "risk" | "neutral";
export function Card({ children, className = "", tone, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode; tone?: CardTone }) {
  return <section className={`panel ${tone ? `panel-${tone}` : ""} ${className}`.trim()} {...props}>{children}</section>;
}
