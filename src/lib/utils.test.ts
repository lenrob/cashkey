import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

// Proves the harness itself, not the behaviour of cn(). The alias case is
// here because `@/` resolution under Vitest is the part of this config most
// likely to break quietly — better it fails here than inside a migration test.
describe("test harness", () => {
  it("runs a test", () => {
    expect(true).toBe(true);
  });

  it("resolves the @/ alias", () => {
    expect(cn("a", "b")).toBe("a b");
  });
});
