import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "go" | "wait" | "risk" | "neutral";
export function Badge({ tone = "neutral", children, className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone} ${className}`.trim()} {...props}>{children}</span>;
}
