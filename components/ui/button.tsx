import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md" | "icon";
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "border border-[var(--primary)] bg-[var(--primary)] text-white hover:border-[var(--primary-strong)] hover:bg-[var(--primary-strong)]",
  secondary: "border border-[var(--line-strong)] bg-white text-[var(--ink)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]",
  ghost: "border border-transparent bg-transparent text-[var(--ink-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)]",
  danger: "border border-[var(--danger)] bg-[var(--danger)] text-white hover:bg-[#8e2635]",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-3.5 text-sm",
  icon: "size-9 p-0",
};

export function Button({ className, size = "md", type = "button", variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)] disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
