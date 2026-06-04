import { type InputHTMLAttributes, forwardRef, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, helper, error, className = "", id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-app-text"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            "w-full rounded-xl border px-3 py-2.5 text-base bg-surface text-app-text",
            "placeholder:text-gray-400",
            "transition-colors duration-150",
            "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
            error
              ? "border-red-500 focus:ring-red-400/30 focus:border-red-500"
              : "border-border",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          ].join(" ")}
          {...props}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        {!error && helper && <p className="text-xs text-muted">{helper}</p>}
      </div>
    );
  },
);

Input.displayName = "Input";
export { Input };
