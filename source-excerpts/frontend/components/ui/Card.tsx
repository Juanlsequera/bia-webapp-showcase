import { type HTMLAttributes, forwardRef } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Quita el padding interno — útil cuando el contenido maneja su propio spacing */
  noPadding?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ noPadding, className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={[
          "bg-surface rounded-2xl shadow-sm border border-border",
          noPadding ? "" : "p-4",
          className,
        ].join(" ")}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Card.displayName = "Card";
export { Card };
