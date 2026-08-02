import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  decodeState,
  encodeState,
  getStateFromUrl,
  updateUrlWithState,
} from "@/utils/urlUtils";
import type { CashflowState } from "@/types/cashflow";
import {
  SAMPLE_BUDGET,
  SAMPLE_BUDGET_HREF,
  VARIATION_SELECTOR_NAMES,
} from "@/utils/urlUtils.fixtures";

// CHARACTERIZATION TESTS.
//
// These describe URL serialization as it behaves TODAY, before Phase 1 changes
// the schema. Several assertions below lock in behaviour that is arguably
// wrong; each is marked QUIRK with a note. They are deliberately not fixed
// here — the point of this PR is a safety net, and a net that describes the
// code as we wish it were catches nothing.

/**
 * urlUtils reads window.location.href and calls window.history.replaceState.
 * Node supplies URL and URLSearchParams already, so a stub with those two
 * properties is the whole DOM requirement — no jsdom needed.
 */
const stubWindow = (href: string) => {
  const replaceState = vi.fn();
  vi.stubGlobal("window", { location: { href }, history: { replaceState } });
  return replaceState;
};

/**
 * decodeState and encodeState both log to console.error when they reject
 * input. That is asserted once, below; everywhere else it is silenced so an
 * expected stack trace cannot bury a real failure.
 */
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const encodedOf = (state: CashflowState) => encodeURIComponent(JSON.stringify(state));

describe("encodeState / decodeState round-trip", () => {
  it("round-trips a representative budget without loss", () => {
    expect(decodeState(encodeState(SAMPLE_BUDGET))).toEqual(SAMPLE_BUDGET);
  });

  it("round-trips an empty budget", () => {
    const empty: CashflowState = { incomes: [], expenses: [] };
    expect(decodeState(encodeState(empty))).toEqual(empty);
  });

  it("preserves amount precision, including decimals and zero", () => {
    const state: CashflowState = {
      incomes: [{ id: "a", name: "Odd", amount: 1234.56 }],
      expenses: [{ id: "b", name: "Zero", amount: 0 }],
    };
    const decoded = decodeState(encodeState(state));
    expect(decoded?.incomes[0].amount).toBe(1234.56);
    expect(decoded?.expenses[0].amount).toBe(0);
  });

  it("preserves the optional color field when present", () => {
    const state: CashflowState = {
      incomes: [{ id: "a", name: "Paid", amount: 1, color: "#ff0000" }],
      expenses: [],
    };
    expect(decodeState(encodeState(state))?.incomes[0].color).toBe("#ff0000");
  });

  it("preserves item order", () => {
    const decoded = decodeState(encodeState(SAMPLE_BUDGET));
    expect(decoded?.expenses.map((e) => e.name)).toEqual(
      SAMPLE_BUDGET.expenses.map((e) => e.name),
    );
  });
});

describe("multi-codepoint emoji", () => {
  it.each(VARIATION_SELECTOR_NAMES)("round-trips %s byte-for-byte", (name) => {
    const state: CashflowState = {
      incomes: [],
      expenses: [{ id: "x", name, amount: 1 }],
    };
    expect(decodeState(encodeState(state))?.expenses[0].name).toBe(name);
  });

  it("carries VARIATION SELECTOR-16 through the round-trip", () => {
    // "🏝️" is U+1F3DD followed by U+FE0F — two codepoints, three UTF-16 units.
    // A naive [...name][0] in PR 1.2 would take only the island and drop the
    // selector, which renders differently.
    const name = "🏝️ Vacation";
    expect([...name].length).toBe(11);
    expect(name.length).toBe(12);
    expect([...name][1]).toBe("️");

    const state: CashflowState = {
      incomes: [],
      expenses: [{ id: "x", name, amount: 4940 }],
    };
    const decoded = decodeState(encodeState(state))?.expenses[0].name ?? "";
    expect([...decoded].length).toBe(11);
    expect(decoded.codePointAt(0)).toBe(0x1f3dd);
    expect(decoded.codePointAt(2)).toBe(0xfe0f);
  });

  it("encodes the variation selector as %EF%B8%8F", () => {
    expect(encodeState({ incomes: [], expenses: [] })).not.toContain("%EF%B8%8F");
    expect(
      encodeState({
        incomes: [],
        expenses: [{ id: "x", name: "🏝️", amount: 1 }],
      }),
    ).toContain("%EF%B8%8F");
  });
});

describe("decodeState rejects malformed input", () => {
  it.each([
    ["an empty string", ""],
    ["text that is not JSON", "not-json-at-all"],
    ["truncated JSON", encodeURIComponent('{"incomes":')],
    ["a malformed percent escape", "%E0%A4%A"],
    ["a bare percent sign", "%"],
    ["JSON null", encodeURIComponent("null")],
  ])("returns null for %s", (_label, input) => {
    expect(decodeState(input)).toBeNull();
  });

  it("reports the failure through console.error", () => {
    expect(decodeState("not-json-at-all")).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "Error decoding state:",
      expect.any(SyntaxError),
    );
  });

  it("does not throw on hostile input", () => {
    const hostile = [
      encodeURIComponent('{"incomes":{"__proto__":{"polluted":true}}}'),
      encodeURIComponent('{"__proto__":{"polluted":true}}'),
      "%00%01%02",
      "\uD800",
    ];
    for (const input of hostile) {
      expect(() => decodeState(input)).not.toThrow();
    }
    expect({}).not.toHaveProperty("polluted");
  });
});

describe("decodeState coercion", () => {
  it("replaces a non-array incomes or expenses with an empty array", () => {
    const decoded = decodeState(
      encodeURIComponent('{"incomes":"nope","expenses":null}'),
    );
    expect(decoded).toEqual({ incomes: [], expenses: [] });
  });

  it("drops unrecognized top-level keys", () => {
    const decoded = decodeState(
      encodeURIComponent('{"incomes":[],"expenses":[],"expansionState":{"a":1}}'),
    );
    expect(decoded).toEqual({ incomes: [], expenses: [] });
    expect(decoded).not.toHaveProperty("expansionState");
  });

  // QUIRK: a scalar JSON payload yields an empty-but-truthy state rather than
  // null. Index.tsx only falls back to sample data when getStateFromUrl() is
  // falsy, so ?data=123 renders a blank app instead of the sample budget.
  it.each([
    ["a number", "123"],
    ["a string", '"hello"'],
    ["a boolean", "true"],
    ["an array", "[1,2,3]"],
  ])("QUIRK: returns an empty state, not null, for %s", (_label, json) => {
    expect(decodeState(encodeURIComponent(json))).toEqual({
      incomes: [],
      expenses: [],
    });
  });

  // QUIRK: validation stops at the top level. Items are passed through with no
  // shape checking at all, so "never trust the URL" is only half-implemented.
  it("QUIRK: passes items through without validating their shape", () => {
    const decoded = decodeState(
      encodeURIComponent('{"incomes":[{"junk":1}],"expenses":[]}'),
    );
    expect(decoded?.incomes).toEqual([{ junk: 1 }]);
  });

  it("QUIRK: accepts a non-numeric amount", () => {
    const decoded = decodeState(
      encodeURIComponent(
        '{"incomes":[{"id":"x","name":"n","amount":"NOT_A_NUMBER"}],"expenses":[]}',
      ),
    );
    expect(decoded?.incomes[0].amount).toBe("NOT_A_NUMBER");
  });
});

describe("encodeState failure", () => {
  it("returns an empty string when the state cannot be serialized", () => {
    const circular = { incomes: [], expenses: [] } as CashflowState & {
      self?: unknown;
    };
    circular.self = circular;
    expect(encodeState(circular)).toBe("");
  });

  it("QUIRK: an empty encode result decodes to null, losing the budget", () => {
    // encodeState returning "" is indistinguishable from "no data in the URL".
    expect(decodeState("")).toBeNull();
  });
});

describe("double encoding", () => {
  it("QUIRK: the app writes TWO layers of encoding into the address bar", () => {
    // encodeState percent-encodes, then URLSearchParams.set encodes the % signs
    // again. CLAUDE.md describes this the other way round — as links arriving
    // with %257B where the app wrote %7B. The app writes %257B itself.
    const replaceState = stubWindow("https://cashkey.app/");
    updateUrlWithState(SAMPLE_BUDGET);

    const written = replaceState.mock.calls[0][2] as string;
    expect(written).toContain("%257B");
    expect(written).not.toContain("?data=%7B");
  });

  it("reads back a URL the app wrote, double encoding and all", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    expect(getStateFromUrl()).toEqual(SAMPLE_BUDGET);
  });

  it("also reads a link that arrives with only one layer of encoding", () => {
    // searchParams.get() performs one decode, decodeState performs another. A
    // singly-encoded link survives only because the second decode is a no-op
    // on a string containing no % signs.
    stubWindow(`https://cashkey.app/?data=${encodedOf(SAMPLE_BUDGET)}`);
    expect(getStateFromUrl()).toEqual(SAMPLE_BUDGET);
  });

  // QUIRK: nothing detects or unwraps extra encoding layers. R-PER-1 requires
  // it; today decodeState applies exactly one decodeURIComponent.
  it("QUIRK: decodeState alone returns null for doubly-encoded input", () => {
    const doubled = encodeURIComponent(encodeState(SAMPLE_BUDGET));
    expect(doubled.startsWith("%257B")).toBe(true);
    expect(decodeState(doubled)).toBeNull();
  });

  it("QUIRK: a third encoding layer in the URL is not unwrapped", () => {
    const tripled = encodeURIComponent(encodeState(SAMPLE_BUDGET));
    stubWindow(`https://cashkey.app/?data=${encodeURIComponent(tripled)}`);
    expect(getStateFromUrl()).toBeNull();
  });

  // QUIRK: the layer asymmetry has teeth. A literal % in a category name
  // survives an app-written URL but destroys a singly-encoded one, and the
  // user sees their budget silently replaced by sample data.
  it("QUIRK: a % in a name survives two layers but not one", () => {
    const state: CashflowState = {
      incomes: [{ id: "a", name: "50% Rule", amount: 1 }],
      expenses: [],
    };

    const replaceState = stubWindow("https://cashkey.app/");
    updateUrlWithState(state);
    const written = replaceState.mock.calls[0][2] as string;
    vi.unstubAllGlobals();

    stubWindow(written);
    expect(getStateFromUrl()).toEqual(state);
    vi.unstubAllGlobals();

    stubWindow(`https://cashkey.app/?data=${encodedOf(state)}`);
    expect(getStateFromUrl()).toBeNull();
  });
});

describe("getStateFromUrl", () => {
  it("returns null when the URL carries no data parameter", () => {
    stubWindow("https://cashkey.app/");
    expect(getStateFromUrl()).toBeNull();
  });

  it("returns null when data is present but empty", () => {
    stubWindow("https://cashkey.app/?data=");
    expect(getStateFromUrl()).toBeNull();
  });

  it("ignores unrelated query parameters", () => {
    stubWindow(`${SAMPLE_BUDGET_HREF}&utm_source=newsletter`);
    expect(getStateFromUrl()).toEqual(SAMPLE_BUDGET);
  });

  it("returns null rather than throwing on a garbage data parameter", () => {
    stubWindow("https://cashkey.app/?data=%%%not-real%%%");
    expect(getStateFromUrl()).toBeNull();
  });
});

describe("updateUrlWithState", () => {
  it("uses replaceState, never pushState, so typing does not fill history", () => {
    const replaceState = stubWindow("https://cashkey.app/");
    updateUrlWithState(SAMPLE_BUDGET);

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(window).not.toHaveProperty("history.pushState");
    const [stateArg, titleArg] = replaceState.mock.calls[0];
    expect(stateArg).toEqual({});
    expect(titleArg).toBe("");
  });

  it("writes a URL that reads back as the same budget", () => {
    const replaceState = stubWindow("https://cashkey.app/");
    updateUrlWithState(SAMPLE_BUDGET);
    const written = replaceState.mock.calls[0][2] as string;
    vi.unstubAllGlobals();

    stubWindow(written);
    expect(getStateFromUrl()).toEqual(SAMPLE_BUDGET);
  });

  it("preserves the path and other query parameters already on the URL", () => {
    const replaceState = stubWindow("https://cashkey.app/budget?ref=twitter");
    updateUrlWithState(SAMPLE_BUDGET);

    const written = new URL(replaceState.mock.calls[0][2] as string);
    expect(written.pathname).toBe("/budget");
    expect(written.searchParams.get("ref")).toBe("twitter");
  });

  it("overwrites an existing data parameter rather than appending", () => {
    const replaceState = stubWindow(SAMPLE_BUDGET_HREF);
    updateUrlWithState({ incomes: [], expenses: [] });

    const written = new URL(replaceState.mock.calls[0][2] as string);
    expect(written.searchParams.getAll("data")).toHaveLength(1);
  });
});

describe("the real-world share link", () => {
  it("is long enough to matter", () => {
    expect(SAMPLE_BUDGET_HREF.length).toBeGreaterThan(2900);
  });

  it("loads the full 16-item budget", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    const decoded = getStateFromUrl();

    expect(decoded?.incomes).toHaveLength(5);
    expect(decoded?.expenses).toHaveLength(11);
    expect(decoded).toEqual(SAMPLE_BUDGET);
  });

  it("preserves the figures the diagram depends on", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    const decoded = getStateFromUrl();

    const total = (items: CashflowState["incomes"]) =>
      items.reduce((sum, item) => sum + item.amount, 0);
    expect(total(decoded?.incomes ?? [])).toBe(60232);
    expect(total(decoded?.expenses ?? [])).toBe(58981);
  });

  it("preserves emoji-bearing names exactly", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    const names = getStateFromUrl()?.expenses.map((e) => e.name) ?? [];

    for (const name of VARIATION_SELECTOR_NAMES) {
      expect(names).toContain(name);
    }
    expect(names).toContain("🏡 Housing");
  });
});
