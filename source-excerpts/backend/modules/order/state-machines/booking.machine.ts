import type { StateMachine } from "./machine.types";

export type BookingOrderState =
  | "scheduled" // estado inicial — cita creada por el cliente
  | "pending" // legacy alias para compat con tenants anteriores
  | "confirmed"
  | "reminder_sent"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "rescheduled"
  | "no_show";

const TRANSITIONS: Record<BookingOrderState, BookingOrderState[]> = {
  scheduled: [
    "confirmed",
    "in_progress",
    "rescheduled",
    "cancelled",
    "no_show",
  ],
  pending: ["confirmed", "cancelled"],
  confirmed: [
    "reminder_sent",
    "in_progress",
    "rescheduled",
    "cancelled",
    "no_show",
  ],
  reminder_sent: ["in_progress", "rescheduled", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  rescheduled: ["confirmed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const bookingMachine: StateMachine<BookingOrderState> = {
  archetype: "booking",
  initial: "pending",
  states: Object.keys(TRANSITIONS) as BookingOrderState[],
  canTransition: (from, to) =>
    (TRANSITIONS[from] ?? []).includes(to as BookingOrderState),
  nextStates: (from) => TRANSITIONS[from] ?? [],
  isTerminal: (state) => (TRANSITIONS[state] ?? []).length === 0,
};
