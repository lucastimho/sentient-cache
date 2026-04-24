import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";
import { PathGuard, PathGuardViolation } from "../src/security/PathGuard";

describe("PathGuard", () => {
  const root = resolve("/tmp/sg-data-test");
  const guard = new PathGuard(root);

  test("allows a direct child of the data volume", () => {
    const abs = guard.resolve("cache.sqlite");
    expect(abs).toBe(`${root}/cache.sqlite`);
  });

  test("allows a nested path inside the data volume", () => {
    const abs = guard.resolve("nested/dir/file.bin");
    expect(abs).toBe(`${root}/nested/dir/file.bin`);
  });

  test("allows the root itself", () => {
    expect(guard.resolve(".")).toBe(root);
  });

  test("refuses an absolute path outside the data volume", () => {
    expect(() => guard.resolve("/etc/passwd")).toThrow(PathGuardViolation);
  });

  test("refuses a relative traversal that escapes the data volume", () => {
    expect(() => guard.resolve("../secrets")).toThrow(PathGuardViolation);
    expect(() => guard.resolve("../../etc/shadow")).toThrow(PathGuardViolation);
  });

  test("refuses a sibling-matching prefix that is not actually inside", () => {
    const narrow = new PathGuard("/tmp/sg-data");
    expect(() => narrow.resolve("/tmp/sg-data-evil/file")).toThrow(PathGuardViolation);
  });

  test("refuses empty and nullish paths", () => {
    expect(() => guard.resolve("")).toThrow(PathGuardViolation);
  });

  test("isInside returns a boolean without throwing", () => {
    expect(guard.isInside("ok.txt")).toBe(true);
    expect(guard.isInside("../nope")).toBe(false);
  });
});
