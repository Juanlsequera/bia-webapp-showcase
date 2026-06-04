import { type HTMLAttributes } from "react";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: "bg-green-100 text-green-800  border-green-200",
  warning: "bg-amber-100  text-amber-800  border-amber-200",
  danger: "bg-red-100    text-red-700    border-red-200",
  info: "bg-blue-100   text-blue-800   border-blue-200",
  neutral: "bg-border     text-muted      border-transparent",
};

function Badge({
  variant = "neutral",
  className = "",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
        variantClasses[variant],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}

export { Badge };
export type { BadgeVariant };
