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
  describeLoadIssues,
  encodeState,
  getStateFromUrl,
  hasIssues,
  noIssues,
  updateUrlWithState,
} from "@/utils/urlUtils";
import type { BudgetLoadResult, LoadIssues } from "@/utils/urlUtils";
import type { CashflowState } from "@/types/cashflow";
import {
  SAMPLE_BUDGET,
  SAMPLE_BUDGET_HREF,
  VARIATION_SELECTOR_NAMES,
} from "@/utils/urlUtils.fixtures";

// Characterization tests, written in PR 0.2 against the behaviour of the day
// and flipped in PR 0.2b as the two data-loss bugs were fixed.
//
// Assertions still marked QUIRK describe behaviour that remains wrong on
// purpose: quirks 4, 6 and 7 are deferred to PR 1.1, where the migration and
// validation layers are built. See docs/requirements/IMPLEMENTATION-PLAN.md.

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
 * expected message cannot bury a real failure.
 */
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Narrows to the loaded variant, failing with a useful message otherwise. */
const expectLoaded = (result: BudgetLoadResult) => {
  if (result.status !== "loaded") {
    throw new Error(`expected a loaded budget, got "${result.status}"`);
  }
  return result;
};

const stateOf = (result: BudgetLoadResult): CashflowState =>
  expectLoaded(result).state;

const issuesOf = (result: BudgetLoadResult): LoadIssues =>
  expectLoaded(result).issues;

const decodeJson = (json: string) => decodeState(encodeURIComponent(json));

const encodedOf = (state: CashflowState) =>
  encodeURIComponent(JSON.stringify(state));

describe("encodeState / decodeState round-trip", () => {
  it("round-trips a representative budget without loss", () => {
    expect(stateOf(decodeState(encodeState(SAMPLE_BUDGET)))).toEqual(SAMPLE_BUDGET);
  });

  it("round-trips an empty budget", () => {
    const empty: CashflowState = { incomes: [], expenses: [] };
    expect(stateOf(decodeState(encodeState(empty)))).toEqual(empty);
  });

  it("reports a clean budget as having no issues", () => {
    expect(hasIssues(issuesOf(decodeState(encodeState(SAMPLE_BUDGET))))).toBe(false);
  });

  it("marks a budget arriving from a link as unsaved scratch", () => {
    const loaded = expectLoaded(decodeState(encodeState(SAMPLE_BUDGET)));
    expect(loaded.source).toBe("url");
    expect(loaded.savedAs).toBeNull();
  });

  it("preserves amount precision, including decimals and zero", () => {
    const state: CashflowState = {
      incomes: [{ id: "a", name: "Odd", amount: 1234.56 }],
      expenses: [{ id: "b", name: "Zero", amount: 0 }],
    };
    const decoded = stateOf(decodeState(encodeState(state)));
    expect(decoded.incomes[0].amount).toBe(1234.56);
    expect(decoded.expenses[0].amount).toBe(0);
  });

  it("preserves the optional color field when present", () => {
    const state: CashflowState = {
      incomes: [{ id: "a", name: "Paid", amount: 1, color: "#ff0000" }],
      expenses: [],
    };
    expect(stateOf(decodeState(encodeState(state))).incomes[0].color).toBe("#ff0000");
  });

  it("preserves item order", () => {
    const decoded = stateOf(decodeState(encodeState(SAMPLE_BUDGET)));
    expect(decoded.expenses.map((e) => e.name)).toEqual(
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
    expect(stateOf(decodeState(encodeState(state))).expenses[0].name).toBe(name);
  });

  it("carries VARIATION SELECTOR-16 through the round-trip", () => {
    // "🏝️" is U+1F3DD followed by U+FE0F — two codepoints, three UTF-16 units.
    // A naive [...name][0] in PR 1.2 would take only the island and drop the
    // selector, which renders differently.
    const name = "🏝️ Vacation";
    expect([...name].length).toBe(11);
    expect(name.length).toBe(12);

    const state: CashflowState = {
      incomes: [],
      expenses: [{ id: "x", name, amount: 4940 }],
    };
    const decoded = stateOf(decodeState(encodeState(state))).expenses[0].name;
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
  it("reports an absent payload as absent, not invalid", () => {
    expect(decodeState("")).toEqual({ status: "absent" });
  });

  it.each([
    ["text that is not JSON", "not-json-at-all"],
    ["truncated JSON", encodeURIComponent('{"incomes":')],
    ["a malformed percent escape", "%E0%A4%A"],
    ["JSON null", encodeURIComponent("null")],
  ])("reports %s as invalid", (_label, input) => {
    expect(decodeState(input)).toEqual({ status: "invalid", reason: "unreadable" });
  });

  it("reports the failure through console.error", () => {
    expect(decodeState("not-json-at-all").status).toBe("invalid");
    expect(consoleError).toHaveBeenCalledWith(
      "Error decoding state: the data parameter could not be read",
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
    expect(stateOf(decodeJson('{"incomes":"nope","expenses":null}'))).toEqual({
      incomes: [],
      expenses: [],
    });
  });

  it("drops unrecognized top-level keys", () => {
    const decoded = stateOf(
      decodeJson('{"incomes":[],"expenses":[],"expansionState":{"a":1}}'),
    );
    expect(decoded).toEqual({ incomes: [], expenses: [] });
    expect(decoded).not.toHaveProperty("expansionState");
  });

  // QUIRK (Q4, deferred to PR 1.1): a scalar payload yields an empty-but-loaded
  // state rather than a failure, so ?data=123 renders a blank app rather than
  // falling back to the sample budget.
  it.each([
    ["a number", "123"],
    ["a string", '"hello"'],
    ["a boolean", "true"],
    ["an array", "[1,2,3]"],
  ])("QUIRK: returns an empty loaded state for %s", (_label, json) => {
    expect(stateOf(decodeJson(json))).toEqual({ incomes: [], expenses: [] });
  });
});

describe("item validation", () => {
  it("drops an item with no usable amount and counts it", () => {
    const result = decodeJson('{"incomes":[{"junk":1}],"expenses":[]}');
    expect(stateOf(result).incomes).toEqual([]);
    expect(issuesOf(result).droppedMalformed).toBe(1);
  });

  it.each([
    ["a non-numeric string", '"NOT_A_NUMBER"'],
    ["an empty string", '""'],
    ["a thousands separator", '"1,200"'],
    ["null", "null"],
    ["an object", "{}"],
  ])("drops an item whose amount is %s", (_label, amount) => {
    const result = decodeJson(
      `{"incomes":[{"id":"x","name":"n","amount":${amount}}],"expenses":[]}`,
    );
    expect(stateOf(result).incomes).toEqual([]);
    expect(issuesOf(result).droppedMalformed).toBe(1);
  });

  it("drops a non-object entry", () => {
    const result = decodeJson('{"incomes":["nope",42,null],"expenses":[]}');
    expect(stateOf(result).incomes).toEqual([]);
    expect(issuesOf(result).droppedMalformed).toBe(3);
  });

  it("counts a negative amount separately from a malformed one", () => {
    const result = decodeJson(
      '{"incomes":[],"expenses":[{"id":"x","name":"Refund","amount":-450},{"id":"y","name":"Bad","amount":"nope"}]}',
    );
    expect(stateOf(result).expenses).toEqual([]);
    expect(issuesOf(result)).toEqual({
      repaired: 0,
      droppedMalformed: 1,
      droppedNegative: 1,
    });
  });

  it("coerces a numeric string amount and counts it as repaired", () => {
    const result = decodeJson(
      '{"incomes":[{"id":"x","name":"Bonus","amount":"1500"}],"expenses":[]}',
    );
    expect(stateOf(result).incomes[0].amount).toBe(1500);
    expect(issuesOf(result).repaired).toBe(1);
  });

  it("generates an id when one is missing, keeping the money", () => {
    const result = decodeJson('{"incomes":[{"name":"Paycheck","amount":100}],"expenses":[]}');
    const item = stateOf(result).incomes[0];

    expect(item.amount).toBe(100);
    expect(item.name).toBe("Paycheck");
    expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(issuesOf(result).repaired).toBe(1);
  });

  it("names an unnamed item rather than discarding its amount", () => {
    const result = decodeJson('{"incomes":[{"id":"x","amount":250}],"expenses":[]}');
    const item = stateOf(result).incomes[0];

    expect(item.name).toBe("Untitled");
    expect(item.amount).toBe(250);
    expect(issuesOf(result).repaired).toBe(1);
  });

  it("counts an item repaired once even when several fields are fixed", () => {
    const result = decodeJson('{"incomes":[{"amount":"75"}],"expenses":[]}');
    expect(issuesOf(result).repaired).toBe(1);
  });

  it("strips a non-string color without counting it as a repair", () => {
    const result = decodeJson(
      '{"incomes":[{"id":"x","name":"n","amount":1,"color":42}],"expenses":[]}',
    );
    expect(stateOf(result).incomes[0]).not.toHaveProperty("color");
    expect(issuesOf(result).repaired).toBe(0);
  });

  it("strips unknown per-item keys", () => {
    const result = decodeJson(
      '{"incomes":[{"id":"x","name":"n","amount":1,"evil":"<script>"}],"expenses":[]}',
    );
    expect(stateOf(result).incomes[0]).toEqual({ id: "x", name: "n", amount: 1 });
  });

  it("keeps the good items when only some are bad", () => {
    const result = decodeJson(
      '{"incomes":[{"id":"a","name":"Good","amount":100},{"junk":1},{"id":"c","name":"Neg","amount":-5}],"expenses":[]}',
    );
    expect(stateOf(result).incomes).toEqual([
      { id: "a", name: "Good", amount: 100 },
    ]);
    expect(issuesOf(result)).toEqual({
      repaired: 0,
      droppedMalformed: 1,
      droppedNegative: 1,
    });
  });

  it("counts issues across both incomes and expenses", () => {
    const result = decodeJson(
      '{"incomes":[{"junk":1}],"expenses":[{"id":"x","name":"n","amount":-1}]}',
    );
    expect(issuesOf(result).droppedMalformed).toBe(1);
    expect(issuesOf(result).droppedNegative).toBe(1);
  });
});

describe("describeLoadIssues", () => {
  it("returns null when nothing needed changing", () => {
    expect(describeLoadIssues(noIssues())).toBeNull();
  });

  it("describes each category of issue", () => {
    expect(
      describeLoadIssues({ repaired: 2, droppedMalformed: 3, droppedNegative: 1 }),
    ).toBe(
      "3 items could not be read, 1 item had a negative amount, 2 items were repaired.",
    );
  });

  it("uses singular wording for a single item", () => {
    expect(
      describeLoadIssues({ repaired: 1, droppedMalformed: 0, droppedNegative: 0 }),
    ).toBe("1 item was repaired.");
  });

  it("mentions only the categories that occurred", () => {
    expect(
      describeLoadIssues({ repaired: 0, droppedMalformed: 0, droppedNegative: 2 }),
    ).toBe("2 items had a negative amount.");
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

  // QUIRK (Q6, deferred to PR 1.1): an encode failure produces "", which the
  // read path cannot distinguish from "no data in the URL".
  it("QUIRK: an empty encode result reads back as absent, not as a failure", () => {
    expect(decodeState("")).toEqual({ status: "absent" });
  });
});

describe("double encoding", () => {
  it("the app writes TWO layers of encoding into the address bar", () => {
    // encodeState percent-encodes, then URLSearchParams.set encodes the % signs
    // again. This is correct and load-bearing: every link ever shared was
    // written this way. See the URL-as-database section of CLAUDE.md.
    const replaceState = stubWindow("https://cashkey.app/");
    updateUrlWithState(SAMPLE_BUDGET);

    const written = replaceState.mock.calls[0][2] as string;
    expect(written).toContain("%257B");
    expect(written).not.toContain("?data=%7B");
  });

  it("reads back a URL the app wrote, double encoding and all", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    expect(stateOf(getStateFromUrl())).toEqual(SAMPLE_BUDGET);
  });

  it("also reads a link that arrives with only one layer of encoding", () => {
    stubWindow(`https://cashkey.app/?data=${encodedOf(SAMPLE_BUDGET)}`);
    expect(stateOf(getStateFromUrl())).toEqual(SAMPLE_BUDGET);
  });

  it("unwraps a doubly-encoded payload", () => {
    const doubled = encodeURIComponent(encodeState(SAMPLE_BUDGET));
    expect(doubled.startsWith("%257B")).toBe(true);
    expect(stateOf(decodeState(doubled))).toEqual(SAMPLE_BUDGET);
  });

  it("unwraps a third encoding layer picked up in transit", () => {
    const doubled = encodeURIComponent(encodeState(SAMPLE_BUDGET));
    stubWindow(`https://cashkey.app/?data=${encodeURIComponent(doubled)}`);
    expect(stateOf(getStateFromUrl())).toEqual(SAMPLE_BUDGET);
  });

  it("gives up rather than peeling forever", () => {
    let over = encodeState(SAMPLE_BUDGET);
    for (let i = 0; i < 5; i += 1) over = encodeURIComponent(over);
    expect(decodeState(over)).toEqual({ status: "invalid", reason: "unreadable" });
  });

  it("does not decode a payload that is already plain JSON", () => {
    // Decoding first would turn "100%20 off" into "100 off" with no error
    // raised. Parsing first means an already-decoded payload is never touched.
    const state: CashflowState = {
      incomes: [{ id: "a", name: "100%20 off", amount: 1 }],
      expenses: [],
    };
    expect(stateOf(decodeState(JSON.stringify(state))).incomes[0].name).toBe(
      "100%20 off",
    );
  });

  it("survives a % in a name at one layer or two", () => {
    const state: CashflowState = {
      incomes: [{ id: "a", name: "50% Rule", amount: 1 }],
      expenses: [],
    };

    const replaceState = stubWindow("https://cashkey.app/");
    updateUrlWithState(state);
    const written = replaceState.mock.calls[0][2] as string;
    vi.unstubAllGlobals();

    stubWindow(written);
    expect(stateOf(getStateFromUrl())).toEqual(state);
    vi.unstubAllGlobals();

    stubWindow(`https://cashkey.app/?data=${encodedOf(state)}`);
    expect(stateOf(getStateFromUrl())).toEqual(state);
  });
});

describe("getStateFromUrl", () => {
  it("reports absent when the URL carries no data parameter", () => {
    stubWindow("https://cashkey.app/");
    expect(getStateFromUrl()).toEqual({ status: "absent" });
  });

  it("reports absent when data is present but empty", () => {
    stubWindow("https://cashkey.app/?data=");
    expect(getStateFromUrl()).toEqual({ status: "absent" });
  });

  it("distinguishes a failed parse from an absent parameter", () => {
    // The distinction Index.tsx depends on: an absent parameter seeds the
    // sample budget, a failed parse must never do so.
    stubWindow("https://cashkey.app/?data=%%%not-real%%%");
    expect(getStateFromUrl()).toEqual({ status: "invalid", reason: "unreadable" });
  });

  it("ignores unrelated query parameters", () => {
    stubWindow(`${SAMPLE_BUDGET_HREF}&utm_source=newsletter`);
    expect(stateOf(getStateFromUrl())).toEqual(SAMPLE_BUDGET);
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
    expect(stateOf(getStateFromUrl())).toEqual(SAMPLE_BUDGET);
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

  it("loads the full 16-item budget with nothing repaired or dropped", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    const result = getStateFromUrl();

    expect(stateOf(result).incomes).toHaveLength(5);
    expect(stateOf(result).expenses).toHaveLength(11);
    expect(stateOf(result)).toEqual(SAMPLE_BUDGET);
    expect(hasIssues(issuesOf(result))).toBe(false);
  });

  it("preserves the figures the diagram depends on", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    const decoded = stateOf(getStateFromUrl());

    const total = (items: CashflowState["incomes"]) =>
      items.reduce((sum, item) => sum + item.amount, 0);
    expect(total(decoded.incomes)).toBe(60232);
    expect(total(decoded.expenses)).toBe(58981);
  });

  it("preserves emoji-bearing names exactly", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    const names = stateOf(getStateFromUrl()).expenses.map((e) => e.name);

    for (const name of VARIATION_SELECTOR_NAMES) {
      expect(names).toContain(name);
    }
    expect(names).toContain("🏡 Housing");
  });
});
