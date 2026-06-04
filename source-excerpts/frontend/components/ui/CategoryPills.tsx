import clsx from "clsx";

interface CategoryPillsProps {
  categories: string[];
  active: string | null;
  onChange: (category: string | null) => void;
  allLabel?: string; // label para "Todos" — default: 'Todos'
}

/**
 * CategoryPills — scroll horizontal de filtros de categoría.
 *
 * La píldora activa usa --color-primary del tenant.
 * "Todos" siempre aparece primero y activa cuando active === null.
 */
export function CategoryPills({
  categories,
  active,
  onChange,
  allLabel = "Todos",
}: CategoryPillsProps) {
  const pills = [allLabel, ...categories];

  return (
    <div
      className="flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none"
      style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
    >
      {pills.map((cat) => {
        const isActive = cat === allLabel ? active === null : active === cat;
        return (
          <button
            key={cat}
            onClick={() => onChange(cat === allLabel ? null : cat)}
            className={clsx(
              "shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors",
              isActive
                ? "border-transparent text-white"
                : "border-gray-200 text-gray-500 bg-white hover:bg-gray-50",
            )}
            style={
              isActive
                ? {
                    backgroundColor: "var(--color-primary, #111827)",
                    color: "var(--color-primary-fg, #fff)",
                  }
                : undefined
            }
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}
