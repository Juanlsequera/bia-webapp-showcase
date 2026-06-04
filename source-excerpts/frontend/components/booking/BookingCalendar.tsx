/**
 * BookingCalendar — calendario mensual para selección de fecha de reserva.
 *
 * Props:
 *   year / month      : mes a mostrar (mes: 1-12)
 *   availableDates    : días con al menos 1 slot libre (YYYY-MM-DD[])
 *   selectedDate      : día actualmente seleccionado
 *   onDaySelect       : callback al hacer click en un día disponible
 *   onMonthChange     : callback al navegar de mes  (year, month: 1-12)
 *   loading           : muestra skeleton mientras carga la disponibilidad
 */

interface BookingCalendarProps {
  year: number;
  month: number; // 1-12
  availableDates: string[];
  selectedDate: string | null;
  onDaySelect: (date: string) => void;
  onMonthChange: (year: number, month: number) => void;
  loading?: boolean;
}

const DAY_LABELS = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function BookingCalendar({
  year,
  month,
  availableDates,
  selectedDate,
  onDaySelect,
  onMonthChange,
  loading = false,
}: BookingCalendarProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstDayOfMonth = new Date(year, month - 1, 1);
  // getDay() returns 0=Sun … 6=Sat; convert to Mon-based (0=Mon … 6=Sun)
  const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();

  const availableSet = new Set(availableDates);

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("es-VE", {
    month: "long",
    year: "numeric",
  });

  function prevMonth() {
    if (month === 1) onMonthChange(year - 1, 12);
    else onMonthChange(year, month - 1);
  }
  function nextMonth() {
    if (month === 12) onMonthChange(year + 1, 1);
    else onMonthChange(year, month + 1);
  }

  // Build grid cells (nulls for empty leading cells)
  const cells: Array<number | null> = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last week row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div
      className="w-full select-none"
      aria-label="Calendario de disponibilidad"
    >
      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={prevMonth}
          aria-label="Mes anterior"
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
        >
          ←
        </button>
        <p className="text-sm font-semibold text-gray-800 capitalize">
          {monthLabel}
        </p>
        <button
          onClick={nextMonth}
          aria-label="Mes siguiente"
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
        >
          →
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            className="text-center text-xs text-gray-400 font-medium py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} />;
          }

          const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
          const isPast = new Date(`${dateStr}T00:00:00`) < today;
          const isAvailable = !isPast && availableSet.has(dateStr);
          const isSelected = selectedDate === dateStr;
          const isToday =
            dateStr ===
            `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

          if (loading) {
            return (
              <div
                key={dateStr}
                className="mx-auto w-9 h-9 rounded-full bg-gray-100 animate-pulse"
              />
            );
          }

          const disabled = isPast || !isAvailable;

          return (
            <button
              key={dateStr}
              onClick={() => isAvailable && onDaySelect(dateStr)}
              disabled={disabled}
              aria-label={`${day} ${monthLabel}`}
              aria-disabled={disabled}
              aria-pressed={isSelected}
              className={`mx-auto w-9 h-9 rounded-full text-sm font-medium transition-all flex items-center justify-center
                ${
                  isSelected
                    ? "text-white"
                    : isPast
                      ? "text-gray-300 cursor-not-allowed"
                      : isAvailable
                        ? "text-gray-800 border hover:shadow-sm cursor-pointer"
                        : "text-gray-300 cursor-not-allowed"
                }
                ${isToday && !isSelected ? "font-bold" : ""}
              `}
              style={
                isSelected
                  ? { backgroundColor: "var(--color-primary, #111827)" }
                  : isAvailable
                    ? { borderColor: "var(--color-primary, #111827)" }
                    : undefined
              }
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
