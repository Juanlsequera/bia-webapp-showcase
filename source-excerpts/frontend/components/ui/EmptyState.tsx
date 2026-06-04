import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-3 py-12 px-4 text-center",
        className,
      ].join(" ")}
    >
      {Icon && (
        <div className="flex size-14 items-center justify-center rounded-2xl bg-border text-muted">
          <Icon size={28} />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-app-text">{title}</p>
        {description && (
          <p className="text-sm text-muted max-w-xs">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export { EmptyState };
