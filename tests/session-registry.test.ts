import { describe, test, expect } from "bun:test";
import { SessionRegistry } from "../src/controller/SessionRegistry";

describe("SessionRegistry", () => {
  test("first task for a session is always a change", () => {
    const r = new SessionRegistry();
    const result = r.setTask("s1", "plan-trip");
    expect(result.changed).toBe(true);
    expect(result.previous).toBeUndefined();
    expect(result.current).toBe("plan-trip");
  });

  test("identical task is not a change", () => {
    const r = new SessionRegistry();
    r.setTask("s1", "plan-trip");
    const second = r.setTask("s1", "plan-trip");
    expect(second.changed).toBe(false);
    expect(second.previous).toBe("plan-trip");
  });

  test("different task flips changed=true and reports previous", () => {
    const r = new SessionRegistry();
    r.setTask("s1", "plan-trip");
    const second = r.setTask("s1", "book-flights");
    expect(second.changed).toBe(true);
    expect(second.previous).toBe("plan-trip");
    expect(second.current).toBe("book-flights");
  });

  test("tasks are tracked per-session", () => {
    const r = new SessionRegistry();
    r.setTask("a", "task-a");
    r.setTask("b", "task-b");
    expect(r.getTask("a")).toBe("task-a");
    expect(r.getTask("b")).toBe("task-b");
    expect(r.size()).toBe(2);
  });

  test("clear removes a session", () => {
    const r = new SessionRegistry();
    r.setTask("x", "t");
    r.clear("x");
    expect(r.getTask("x")).toBeUndefined();
    expect(r.size()).toBe(0);
  });
});
