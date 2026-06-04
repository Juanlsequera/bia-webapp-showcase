import type { StateMachine } from "./machine.types";

export type ServicesOrderState =
  | "inquiry"
  | "quoted"
  | "approved"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "rejected"
  | "cancelled";

const TRANSITIONS: Record<ServicesOrderState, ServicesOrderState[]> = {
  inquiry: ["quoted", "cancelled"],
  quoted: ["approved", "rejected", "cancelled"],
  approved: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export const servicesMachine: StateMachine<ServicesOrderState> = {
  archetype: "service",
  initial: "inquiry",
  states: Object.keys(TRANSITIONS) as ServicesOrderState[],
  canTransition: (from, to) =>
    (TRANSITIONS[from] ?? []).includes(to as ServicesOrderState),
  nextStates: (from) => TRANSITIONS[from] ?? [],
  isTerminal: (state) => (TRANSITIONS[state] ?? []).length === 0,
};
