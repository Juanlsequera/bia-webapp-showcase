import { bookingMachine } from "./booking.machine";

describe("bookingMachine", () => {
  it("archetype es booking", () => {
    expect(bookingMachine.archetype).toBe("booking");
  });

  it("estado inicial es pending", () => {
    expect(bookingMachine.initial).toBe("pending");
  });

  it("pending → confirmed es válido", () => {
    expect(bookingMachine.canTransition("pending", "confirmed")).toBe(true);
  });

  it("confirmed → reminder_sent es válido", () => {
    expect(bookingMachine.canTransition("confirmed", "reminder_sent")).toBe(
      true,
    );
  });

  it("confirmed → rescheduled es válido", () => {
    expect(bookingMachine.canTransition("confirmed", "rescheduled")).toBe(true);
  });

  it("confirmed → no_show es válido", () => {
    expect(bookingMachine.canTransition("confirmed", "no_show")).toBe(true);
  });

  it("pending → in_progress NO es válido (skip confirmed)", () => {
    expect(bookingMachine.canTransition("pending", "in_progress")).toBe(false);
  });

  it("completed es terminal", () => {
    expect(bookingMachine.isTerminal("completed")).toBe(true);
    expect(bookingMachine.nextStates("completed")).toEqual([]);
  });

  it("no_show es terminal", () => {
    expect(bookingMachine.isTerminal("no_show")).toBe(true);
  });
});
