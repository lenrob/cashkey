import { describe, expect, it } from "vitest";

import { formatCurrency, fromAnnual, itemDisplayName, toAnnual } from "@/utils/cashflowUtils";

describe("toAnnual", () => {
  it("multiplies a monthly amount by 12", () => {
    expect(toAnnual(1384, "monthly")).toBe(16608);
  });

  it("leaves an annual amount unchanged", () => {
    expect(toAnnual(16608, "annual")).toBe(16608);
  });

  it("handles zero", () => {
    expect(toAnnual(0, "monthly")).toBe(0);
  });
});

describe("fromAnnual", () => {
  it("divides an annual amount by 12 for monthly display", () => {
    expect(fromAnnual(16608, "monthly")).toBe(1384);
  });

  it("leaves an annual amount unchanged for annual display", () => {
    expect(fromAnnual(16608, "annual")).toBe(16608);
  });

  it("does not round — a non-multiple-of-12 annual amount stays fractional", () => {
    // R-DM-1's stated risk case: $100/year shown monthly must not silently
    // become a rounded, slightly-wrong figure baked into the return value.
    // Rounding is a presentation concern (formatCurrency, or an edit-field
    // seed), never baked into the conversion itself.
    expect(fromAnnual(100, "monthly")).toBeCloseTo(8.3333333, 5);
  });
});

describe("toAnnual / fromAnnual round-trip", () => {
  it("round-trips a monthly entry with no drift", () => {
    // The exact scenario called out in review: enter $1,384/month, save
    // (toAnnual), then re-edit (fromAnnual) — must land back on 1384
    // exactly, not 1383.99..., because a monthly entry is always stored as
    // an exact multiple of 12.
    const monthly = 1384;
    const annual = toAnnual(monthly, "monthly");
    expect(fromAnnual(annual, "monthly")).toBe(monthly);
  });

  it("round-trips an annual entry with no conversion at all", () => {
    const annual = 54132;
    expect(fromAnnual(toAnnual(annual, "annual"), "annual")).toBe(annual);
  });
});

describe("itemDisplayName", () => {
  it("concatenates emoji and name when emoji is present", () => {
    expect(itemDisplayName({ emoji: "🏡", name: "Housing" })).toBe("🏡 Housing");
  });

  it("returns just the name when emoji is absent", () => {
    expect(itemDisplayName({ name: "Housing" })).toBe("Housing");
  });
});

describe("formatCurrency", () => {
  it("formats a whole-dollar amount with no decimal places", () => {
    expect(formatCurrency(16608)).toBe("$16,608");
  });

  it("rounds a fractional amount to the nearest dollar for display", () => {
    expect(formatCurrency(1383.999999)).toBe("$1,384");
  });
});
