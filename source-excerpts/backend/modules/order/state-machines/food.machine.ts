import type { StateMachine } from "./machine.types";

export type FoodOrderState =
  | "confirmed"
  | "pending_verification"
  | "pending_cash"
  | "paid"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

const TRANSITIONS: Record<FoodOrderState, FoodOrderState[]> = {
  confirmed: [], // payment flows manejan las salidas de confirmed
  pending_cash: ["cancelled"],
  pending_verification: ["cancelled"],
  paid: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["delivered"],
  delivered: [],
  cancelled: [],
};

export const foodMachine: StateMachine<FoodOrderState> = {
  archetype: "food",
  initial: "confirmed",
  states: Object.keys(TRANSITIONS) as FoodOrderState[],
  canTransition: (from, to) =>
    (TRANSITIONS[from] ?? []).includes(to as FoodOrderState),
  nextStates: (from) => TRANSITIONS[from] ?? [],
  isTerminal: (state) => (TRANSITIONS[state] ?? []).length === 0,
};
