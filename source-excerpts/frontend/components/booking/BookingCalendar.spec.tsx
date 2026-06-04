import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookingCalendar } from "./BookingCalendar";

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderCalendar(
  overrides: Partial<Parameters<typeof BookingCalendar>[0]> = {},
) {
  const defaults = {
    year: 2026,
    month: 7, // julio
    availableDates: ["2026-07-10", "2026-07-15", "2026-07-20"],
    selectedDate: null,
    onDaySelect: vi.fn(),
    onMonthChange: vi.fn(),
    loading: false,
  };
  const props = { ...defaults, ...overrides };
  const result = render(<BookingCalendar {...props} />);
  return { ...result, props };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("BookingCalendar", () => {
  describe("renderizado básico", () => {
    it("muestra el mes y año correcto en el encabezado", () => {
      renderCalendar({ year: 2026, month: 7 });
      expect(screen.getByText(/julio.*2026/i)).toBeTruthy();
    });

    it("muestra las etiquetas de días de la semana", () => {
      renderCalendar();
      expect(screen.getByText("lu")).toBeTruthy();
      expect(screen.getByText("do")).toBeTruthy();
    });

    it("no lanza errores al renderizar", () => {
      expect(() => renderCalendar()).not.toThrow();
    });
  });

  describe("navegación de mes", () => {
    it("click en → llama onMonthChange con el mes siguiente", () => {
      const { props } = renderCalendar({ year: 2026, month: 7 });
      const nextBtn = screen.getByLabelText("Mes siguiente");
      fireEvent.click(nextBtn);
      expect(props.onMonthChange).toHaveBeenCalledWith(2026, 8);
    });

    it("click en ← llama onMonthChange con el mes anterior", () => {
      const { props } = renderCalendar({ year: 2026, month: 7 });
      const prevBtn = screen.getByLabelText("Mes anterior");
      fireEvent.click(prevBtn);
      expect(props.onMonthChange).toHaveBeenCalledWith(2026, 6);
    });

    it("navegar desde enero hacia atrás llama al año anterior mes 12", () => {
      const { props } = renderCalendar({ year: 2026, month: 1 });
      fireEvent.click(screen.getByLabelText("Mes anterior"));
      expect(props.onMonthChange).toHaveBeenCalledWith(2025, 12);
    });

    it("navegar desde diciembre hacia adelante llama al año siguiente mes 1", () => {
      const { props } = renderCalendar({ year: 2026, month: 12 });
      fireEvent.click(screen.getByLabelText("Mes siguiente"));
      expect(props.onMonthChange).toHaveBeenCalledWith(2027, 1);
    });
  });

  describe("días pasados", () => {
    it('días antes de hoy tienen aria-disabled="true"', () => {
      // Usar un año claramente pasado
      renderCalendar({ year: 2020, month: 1, availableDates: ["2020-01-15"] });
      const cells = screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-disabled") === "true");
      // Todos los días de 2020 son pasados
      expect(cells.length).toBeGreaterThan(0);
    });

    it("días pasados no llaman a onDaySelect al hacer click", () => {
      const onDaySelect = vi.fn();
      renderCalendar({ year: 2020, month: 1, availableDates: [], onDaySelect });
      const disabledBtns = screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-disabled") === "true");
      if (disabledBtns.length > 0) {
        fireEvent.click(disabledBtns[0]);
        expect(onDaySelect).not.toHaveBeenCalled();
      }
    });
  });

  describe("días no disponibles", () => {
    it('días sin slot disponible tienen aria-disabled="true"', () => {
      // Fecha futura pero sin ningún día en availableDates
      renderCalendar({ year: 2099, month: 6, availableDates: [] });
      const disabledDays = screen
        .getAllByRole("button")
        .filter(
          (b) =>
            /^\d+$/.test(b.textContent ?? "") &&
            b.getAttribute("aria-disabled") === "true",
        );
      expect(disabledDays.length).toBeGreaterThan(0);
    });
  });

  describe("días disponibles", () => {
    it("click en día disponible llama a onDaySelect con formato YYYY-MM-DD", () => {
      const onDaySelect = vi.fn();
      renderCalendar({
        year: 2099,
        month: 6,
        availableDates: ["2099-06-15"],
        onDaySelect,
      });
      const btn = screen.getByLabelText(/15.*junio.*2099/i);
      fireEvent.click(btn);
      expect(onDaySelect).toHaveBeenCalledWith("2099-06-15");
    });
  });

  describe("día seleccionado", () => {
    it('el día seleccionado tiene aria-pressed="true"', () => {
      renderCalendar({
        year: 2099,
        month: 6,
        availableDates: ["2099-06-15"],
        selectedDate: "2099-06-15",
      });
      const btn = screen.getByLabelText(/15.*junio.*2099/i);
      expect(btn.getAttribute("aria-pressed")).toBe("true");
    });
  });

  describe("loading", () => {
    it("cuando loading=true muestra skeleton en lugar de botones de día", () => {
      renderCalendar({ loading: true });
      // Los skeletons tienen la clase animate-pulse
      const skeletons = document.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("cuando loading=true no hay botones de día clickeables", () => {
      renderCalendar({ loading: true });
      const dayBtns = screen
        .queryAllByRole("button")
        .filter((b) => /^\d+$/.test(b.textContent ?? ""));
      expect(dayBtns).toHaveLength(0);
    });
  });
});
