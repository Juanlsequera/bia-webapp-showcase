import { type HTMLAttributes } from "react";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Forma circular — útil para avatars e íconos */
  circle?: boolean;
}

function Skeleton({ circle, className = "", ...props }: SkeletonProps) {
  return (
    <div
      className={[
        "animate-pulse bg-border",
        circle ? "rounded-full" : "rounded-xl",
        className,
      ].join(" ")}
      {...props}
    />
  );
}

export { Skeleton };
