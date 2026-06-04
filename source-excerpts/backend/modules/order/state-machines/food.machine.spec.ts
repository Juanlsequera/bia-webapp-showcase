import { foodMachine } from "./food.machine";

describe("foodMachine", () => {
  it("archetype es food", () => {
    expect(foodMachine.archetype).toBe("food");
  });

  it("estado inicial es confirmed", () => {
    expect(foodMachine.initial).toBe("confirmed");
  });

  it("paid → preparing es válido", () => {
    expect(foodMachine.canTransition("paid", "preparing")).toBe(true);
  });

  it("paid → cancelled es válido", () => {
    expect(foodMachine.canTransition("paid", "cancelled")).toBe(true);
  });

  it("preparing → ready es válido", () => {
    expect(foodMachine.canTransition("preparing", "ready")).toBe(true);
  });

  it("ready → delivered es válido", () => {
    expect(foodMachine.canTransition("ready", "delivered")).toBe(true);
  });

  it("pending_cash → preparing NO es válido", () => {
    expect(foodMachine.canTransition("pending_cash", "preparing")).toBe(false);
  });

  it("delivered es terminal", () => {
    expect(foodMachine.isTerminal("delivered")).toBe(true);
    expect(foodMachine.nextStates("delivered")).toEqual([]);
  });

  it("cancelled es terminal", () => {
    expect(foodMachine.isTerminal("cancelled")).toBe(true);
  });

  it("confirmed → [] (payment flows lo manejan aparte)", () => {
    expect(foodMachine.nextStates("confirmed")).toEqual([]);
  });
});
