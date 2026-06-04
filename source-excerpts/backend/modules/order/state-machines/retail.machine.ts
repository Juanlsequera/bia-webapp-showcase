import type { StateMachine } from "./machine.types";

export type RetailOrderState =
  | "pending"
  | "payment_review"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "completed"
  | "cancelled"
  | "returned";

const TRANSITIONS: Record<RetailOrderState, RetailOrderState[]> = {
  pending: ["payment_review", "confirmed", "cancelled"],
  payment_review: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["completed", "returned"],
  completed: ["returned"],
  cancelled: [],
  returned: [],
};

export const retailMachine: StateMachine<RetailOrderState> = {
  archetype: "retail",
  initial: "pending",
  states: Object.keys(TRANSITIONS) as RetailOrderState[],
  canTransition: (from, to) =>
    (TRANSITIONS[from] ?? []).includes(to as RetailOrderState),
  nextStates: (from) => TRANSITIONS[from] ?? [],
  isTerminal: (state) => (TRANSITIONS[state] ?? []).length === 0,
};
