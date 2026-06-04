import type { OrderArchetype } from "@foodorder/types";

export interface StateMachine<TState extends string = string> {
  archetype: OrderArchetype;
  initial: TState;
  states: TState[];
  /** Devuelve true si la transición es válida. */
  canTransition(from: TState, to: TState): boolean;
  /** Devuelve los estados a los que se puede ir desde el actual. */
  nextStates(from: TState): TState[];
  /** Es terminal (no se puede salir de él). */
  isTerminal(state: TState): boolean;
}

export class InvalidTransitionError extends Error {
  constructor(
    public archetype: OrderArchetype,
    public from: string,
    public to: string,
  ) {
    super(`Transición inválida en arquetipo "${archetype}": ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}
