import { servicesMachine } from "./services.machine";

describe("servicesMachine", () => {
  it("archetype es service", () => {
    expect(servicesMachine.archetype).toBe("service");
  });

  it("estado inicial es inquiry", () => {
    expect(servicesMachine.initial).toBe("inquiry");
  });

  it("inquiry → quoted es válido", () => {
    expect(servicesMachine.canTransition("inquiry", "quoted")).toBe(true);
  });

  it("quoted → approved es válido", () => {
    expect(servicesMachine.canTransition("quoted", "approved")).toBe(true);
  });

  it("quoted → rejected es válido", () => {
    expect(servicesMachine.canTransition("quoted", "rejected")).toBe(true);
  });

  it("approved → scheduled es válido", () => {
    expect(servicesMachine.canTransition("approved", "scheduled")).toBe(true);
  });

  it("in_progress → completed es válido", () => {
    expect(servicesMachine.canTransition("in_progress", "completed")).toBe(
      true,
    );
  });

  it("inquiry → completed NO es válido (skip steps)", () => {
    expect(servicesMachine.canTransition("inquiry", "completed")).toBe(false);
  });

  it("completed es terminal", () => {
    expect(servicesMachine.isTerminal("completed")).toBe(true);
    expect(servicesMachine.nextStates("completed")).toEqual([]);
  });

  it("rejected es terminal", () => {
    expect(servicesMachine.isTerminal("rejected")).toBe(true);
  });
});
