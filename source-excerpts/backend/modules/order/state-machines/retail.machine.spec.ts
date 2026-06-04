import { retailMachine } from "./retail.machine";

describe("retailMachine", () => {
  it("archetype es retail", () => {
    expect(retailMachine.archetype).toBe("retail");
  });

  it("estado inicial es pending", () => {
    expect(retailMachine.initial).toBe("pending");
  });

  it("confirmed → processing es válido", () => {
    expect(retailMachine.canTransition("confirmed", "processing")).toBe(true);
  });

  it("processing → shipped es válido", () => {
    expect(retailMachine.canTransition("processing", "shipped")).toBe(true);
  });

  it("shipped → delivered es válido", () => {
    expect(retailMachine.canTransition("shipped", "delivered")).toBe(true);
  });

  it("shipped → returned es válido", () => {
    expect(retailMachine.canTransition("shipped", "returned")).toBe(true);
  });

  it("pending → shipped NO es válido (skip processing)", () => {
    expect(retailMachine.canTransition("pending", "shipped")).toBe(false);
  });

  it("cancelled es terminal", () => {
    expect(retailMachine.isTerminal("cancelled")).toBe(true);
    expect(retailMachine.nextStates("cancelled")).toEqual([]);
  });

  it("returned es terminal", () => {
    expect(retailMachine.isTerminal("returned")).toBe(true);
  });

  it("nextStates de pending no está vacío", () => {
    expect(retailMachine.nextStates("pending").length).toBeGreaterThan(0);
  });
});
