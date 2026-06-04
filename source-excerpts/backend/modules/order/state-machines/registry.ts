import type { OrderArchetype } from "@foodorder/types";
import type { StateMachine } from "./machine.types";
import { InvalidTransitionError } from "./machine.types";
import { foodMachine } from "./food.machine";
import { retailMachine } from "./retail.machine";
import { bookingMachine } from "./booking.machine";
import { servicesMachine } from "./services.machine";

const MACHINES: Record<OrderArchetype, StateMachine> = {
  food: foodMachine,
  retail: retailMachine,
  booking: bookingMachine,
  service: servicesMachine,
};

export function getMachine(archetype: OrderArchetype): StateMachine {
  const m = MACHINES[archetype];
  if (!m)
    throw new Error(`No hay máquina de estados para arquetipo "${archetype}"`);
  return m;
}

export { InvalidTransitionError };
