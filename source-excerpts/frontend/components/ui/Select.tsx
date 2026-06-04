import { type SelectHTMLAttributes, forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helper?: string;
  error?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helper, error, className = "", id, children, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm font-medium text-app-text"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={[
              "w-full appearance-none rounded-xl border px-3 py-2.5 pr-9 text-base bg-surface text-app-text",
              "transition-colors duration-150",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
              error
                ? "border-red-500 focus:ring-red-400/30 focus:border-red-500"
                : "border-border",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              className,
            ].join(" ")}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
            size={16}
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        {!error && helper && <p className="text-xs text-muted">{helper}</p>}
      </div>
    );
  },
);

Select.displayName = "Select";
export { Select };
