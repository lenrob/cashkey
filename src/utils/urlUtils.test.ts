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
  CURRENT_SCHEMA_VERSION,
  decodeState,
  describeLoadIssues,
  encodeState,
  getStateFromUrl,
  hasIssues,
  noIssues,
  runMigrations,
  updateUrlWithState,
} from "@/utils/urlUtils";
import type { BudgetLoadResult, LoadIssues } from "@/utils/urlUtils";
import type { CashflowState } from "@/types/cashflow";
import {
  SAMPLE_BUDGET,
  SAMPLE_BUDGET_HREF,
  SAMPLE_BUDGET_MIGRATED,
  VARIATION_SELECTOR_NAMES,
} from "@/utils/urlUtils.fixtures";

// Characterization tests, written in PR 0.2 against the behaviour of the day
// and flipped in PR 0.2b as the two data-loss bugs were fixed. PR 1.1 closes
// the three defects deferred here (Q4, Q6, Q7) and adds the version envelope
// and migration pipeline. See docs/requirements/IMPLEMENTATION-PLAN.md.

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

/** encodeState only returns null for input that can't be JSON-serialized;
 *  every fixture used positively in these tests can be, so narrow to string
 *  here rather than repeating a null check at every call site. */
const encodeOk = (state: CashflowState): string => {
  const encoded = encodeState(state);
  if (encoded === null) throw new Error("expected encodeState to succeed");
  return encoded;
};

describe("encodeState / decodeState round-trip", () => {
  it("round-trips a representative budget without loss", () => {
    expect(stateOf(decodeState(encodeOk(SAMPLE_BUDGET)))).toEqual(SAMPLE_BUDGET);
  });

  it("round-trips an empty budget", () => {
    const empty: CashflowState = { incomes: [], expenses: [] };
    expect(stateOf(decodeState(encodeOk(empty)))).toEqual(empty);
  });

  it("reports a clean budget as having no issues", () => {
    expect(hasIssues(issuesOf(decodeState(encodeOk(SAMPLE_BUDGET))))).toBe(false);
  });

  it("marks a budget arriving from a link as unsaved scratch", () => {
    const loaded = expectLoaded(decodeState(encodeOk(SAMPLE_BUDGET)));
    expect(loaded.source).toBe("url");
    expect(loaded.savedAs).toBeNull();
  });

  it("preserves amount precision, including decimals and zero", () => {
    const state: CashflowState = {
      incomes: [{ id: "a", name: "Odd", amount: 1234.56, frequency: "annual" }],
      expenses: [{ id: "b", name: "Zero", amount: 0, frequency: "annual" }],
    };
    const decoded = stateOf(decodeState(encodeOk(state)));
    expect(decoded.incomes[0].amount).toBe(1234.56);
    expect(decoded.expenses[0].amount).toBe(0);
  });

  it("preserves the optional color field when present", () => {
    const state: CashflowState = {
      incomes: [{ id: "a", name: "Paid", amount: 1, frequency: "annual", color: "#ff0000" }],
      expenses: [],
    };
    expect(stateOf(decodeState(encodeOk(state))).incomes[0].color).toBe("#ff0000");
  });

  it("preserves item order", () => {
    const decoded = stateOf(decodeState(encodeOk(SAMPLE_BUDGET)));
    expect(decoded.expenses.map((e) => e.name)).toEqual(
      SAMPLE_BUDGET.expenses.map((e) => e.name),
    );
  });
});

describe("multi-codepoint emoji", () => {
  it.each(VARIATION_SELECTOR_NAMES)("round-trips %s byte-for-byte", (name) => {
    const state: CashflowState = {
      incomes: [],
      expenses: [{ id: "x", name, amount: 1, frequency: "annual" }],
    };
    expect(stateOf(decodeState(encodeOk(state))).expenses[0].name).toBe(name);
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
      expenses: [{ id: "x", name, amount: 4940, frequency: "annual" }],
    };
    const decoded = stateOf(decodeState(encodeOk(state))).expenses[0].name;
    expect([...decoded].length).toBe(11);
    expect(decoded.codePointAt(0)).toBe(0x1f3dd);
    expect(decoded.codePointAt(2)).toBe(0xfe0f);
  });

  it("encodes the variation selector as %EF%B8%8F", () => {
    expect(encodeState({ incomes: [], expenses: [] })).not.toContain("%EF%B8%8F");
    expect(
      encodeState({
        incomes: [],
        expenses: [{ id: "x", name: "🏝️", amount: 1, frequency: "annual" }],
      }),
    ).toContain("%EF%B8%8F");
  });
});

describe("v1 -> v2 emoji migration", () => {
  // Every raw item here carries an explicit frequency so the v2->v3
  // frequency migration (unrelated to what this block tests) never fires
  // and never inflates `migrated` — this block is isolated to emoji.
  const migrate = (name: string) => {
    const result = decodeJson(
      `{"version":1,"incomes":[],"expenses":[{"id":"x","name":${JSON.stringify(name)},"amount":1,"frequency":"annual"}]}`,
    );
    const item = stateOf(result).expenses[0];
    return { emoji: item.emoji, name: item.name, migrated: issuesOf(result).migrated };
  };

  it("leaves a name with no emoji unchanged and uncounted", () => {
    expect(migrate("Housing")).toEqual({ emoji: undefined, name: "Housing", migrated: 0 });
  });

  it("extracts a leading emoji followed by a space", () => {
    expect(migrate("🏡 Housing")).toEqual({ emoji: "🏡", name: "Housing", migrated: 1 });
  });

  it("does not extract an emoji that is not leading", () => {
    expect(migrate("Housing 🏡")).toEqual({
      emoji: undefined,
      name: "Housing 🏡",
      migrated: 0,
    });
  });

  it.each(VARIATION_SELECTOR_NAMES)(
    "splits a multi-codepoint emoji (%s) intact, selector included",
    (combined) => {
      const spaceIndex = combined.indexOf(" ");
      const expectedEmoji = combined.slice(0, spaceIndex);
      const expectedName = combined.slice(spaceIndex + 1);
      expect(migrate(combined)).toEqual({
        emoji: expectedEmoji,
        name: expectedName,
        migrated: 1,
      });
    },
  );

  it("extracts a leading multi-emoji run as one unit", () => {
    expect(migrate("🎉🎊 Party")).toEqual({ emoji: "🎉🎊", name: "Party", migrated: 1 });
  });

  it("leaves an emoji-only name unchanged — splitting would produce an empty name", () => {
    expect(migrate("🏡")).toEqual({ emoji: undefined, name: "🏡", migrated: 0 });
  });

  it("leaves a name with no separator after the emoji unchanged", () => {
    expect(migrate("🏡Housing")).toEqual({
      emoji: undefined,
      name: "🏡Housing",
      migrated: 0,
    });
  });

  // Guardrails, not incidental passes: if the separator check above is ever
  // loosened, these must keep failing for their own stated reason, not just
  // happen to still pass.
  it("does not split a ZWJ family emoji in half", () => {
    // 👨‍👩‍👧 is U+1F468 ZWJ U+1F469 ZWJ U+1F467 — three pictographs joined by
    // ZWJ (U+200D). The leading-run regex has no ZWJ branch, so it stops
    // after the first pictograph; the character right after that isn't
    // whitespace (it's U+200D), so the separator check rejects the split.
    expect(migrate("👨‍👩‍👧 Family")).toEqual({
      emoji: undefined,
      name: "👨‍👩‍👧 Family",
      migrated: 0,
    });
  });

  it("does not split a regional-indicator flag pair", () => {
    // 🇺🇸 is two Regional_Indicator codepoints, not Extended_Pictographic —
    // the leading-run regex simply doesn't match them, so extraction never
    // starts.
    expect(migrate("🇺🇸 Trip")).toEqual({
      emoji: undefined,
      name: "🇺🇸 Trip",
      migrated: 0,
    });
  });

  it("leaves an item that already has an emoji field untouched and uncounted", () => {
    const result = decodeJson(
      '{"version":1,"incomes":[],"expenses":[{"id":"x","name":"Housing","emoji":"🏠","amount":1,"frequency":"annual"}]}',
    );
    const item = stateOf(result).expenses[0];
    expect(item).toMatchObject({ name: "Housing", emoji: "🏠" });
    expect(issuesOf(result).migrated).toBe(0);
  });
});

describe("v2 -> v3 frequency migration", () => {
  it("backfills a v2 item with no frequency to 'annual' and counts it migrated", () => {
    const result = decodeJson(
      '{"version":2,"incomes":[],"expenses":[{"id":"x","name":"Housing","amount":16608}]}',
    );
    const item = stateOf(result).expenses[0];
    expect(item.frequency).toBe("annual");
    expect(issuesOf(result).migrated).toBe(1);
  });

  it("leaves a v2 item that already carries a valid frequency untouched and uncounted", () => {
    const result = decodeJson(
      '{"version":2,"incomes":[],"expenses":[{"id":"x","name":"Housing","amount":16608,"frequency":"monthly"}]}',
    );
    const item = stateOf(result).expenses[0];
    expect(item.frequency).toBe("monthly");
    expect(issuesOf(result).migrated).toBe(0);
  });

  it("backfills every v1 item on the way through (chained with the emoji migration)", () => {
    const result = decodeJson(
      '{"version":1,"incomes":[],"expenses":[{"id":"x","name":"🏡 Housing","amount":16608}]}',
    );
    const item = stateOf(result).expenses[0];
    expect(item).toMatchObject({ emoji: "🏡", name: "Housing", frequency: "annual" });
    expect(issuesOf(result).migrated).toBe(2);
  });

  it("treats a malformed frequency on a current-version payload as repaired, not migrated", () => {
    // A current-shape payload with a bad value (hand-edited URL, typo'd
    // "weekly") is wrong data, not old data — validateItem's job, not the
    // migration pipeline's.
    const result = decodeJson(
      `{"version":${CURRENT_SCHEMA_VERSION},"incomes":[{"id":"x","name":"n","amount":1,"frequency":"weekly"}],"expenses":[]}`,
    );
    const item = stateOf(result).incomes[0];
    expect(item.frequency).toBe("annual");
    expect(issuesOf(result).repaired).toBe(1);
    expect(issuesOf(result).migrated).toBe(0);
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

  // Q4 (fixed in PR 1.1): a scalar or array payload is not a budget at all,
  // so it must fail rather than decode to a blank-but-loaded state.
  it.each([
    ["a number", "123"],
    ["a string", '"hello"'],
    ["a boolean", "true"],
    ["an array", "[1,2,3]"],
  ])("reports %s as not-a-budget, not an empty loaded state", (_label, json) => {
    expect(decodeJson(json)).toEqual({ status: "invalid", reason: "not-a-budget" });
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
      '{"incomes":[],"expenses":[{"id":"x","name":"Refund","amount":-450,"frequency":"annual"},{"id":"y","name":"Bad","amount":"nope","frequency":"annual"}]}',
    );
    expect(stateOf(result).expenses).toEqual([]);
    expect(issuesOf(result)).toEqual({
      repaired: 0,
      droppedMalformed: 1,
      droppedNegative: 1,
      migrated: 0,
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
    expect(stateOf(result).incomes[0]).toEqual({
      id: "x",
      name: "n",
      amount: 1,
      frequency: "annual",
    });
  });

  it("keeps the good items when only some are bad", () => {
    const result = decodeJson(
      '{"incomes":[{"id":"a","name":"Good","amount":100,"frequency":"annual"},{"junk":1,"frequency":"annual"},{"id":"c","name":"Neg","amount":-5,"frequency":"annual"}],"expenses":[]}',
    );
    expect(stateOf(result).incomes).toEqual([
      { id: "a", name: "Good", amount: 100, frequency: "annual" },
    ]);
    expect(issuesOf(result)).toEqual({
      repaired: 0,
      droppedMalformed: 1,
      droppedNegative: 1,
      migrated: 0,
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

describe("subcategory validation (R-DM-3, expenses only)", () => {
  it("validates an expense's children and rolls up the parent amount from them", () => {
    const result = decodeJson(
      '{"incomes":[],"expenses":[{"id":"p","name":"Housing","amount":999,"frequency":"annual","children":[{"id":"c1","name":"Mortgage","amount":1500,"frequency":"annual"},{"id":"c2","name":"Insurance","amount":300,"frequency":"annual"}]}]}',
    );
    const [housing] = stateOf(result).expenses;
    expect(housing.children).toEqual([
      { id: "c1", name: "Mortgage", amount: 1500, frequency: "annual" },
      { id: "c2", name: "Insurance", amount: 300, frequency: "annual" },
    ]);
    // The serialized 999 disagrees with the children and is never trusted.
    expect(housing.amount).toBe(1800);
  });

  it("drops a malformed child and rolls up from the ones that survive", () => {
    const result = decodeJson(
      '{"incomes":[],"expenses":[{"id":"p","name":"Housing","amount":0,"frequency":"annual","children":[{"id":"c1","name":"Mortgage","amount":1500,"frequency":"annual"},{"junk":1}]}]}',
    );
    const [housing] = stateOf(result).expenses;
    expect(housing.children).toEqual([
      { id: "c1", name: "Mortgage", amount: 1500, frequency: "annual" },
    ]);
    expect(housing.amount).toBe(1500);
    expect(issuesOf(result).droppedMalformed).toBe(1);
  });

  it("treats an empty children array as flat, keeping the direct amount", () => {
    const result = decodeJson(
      '{"incomes":[],"expenses":[{"id":"p","name":"Housing","amount":2000,"frequency":"annual","children":[]}]}',
    );
    const [housing] = stateOf(result).expenses;
    expect(housing.children).toBeUndefined();
    expect(housing.amount).toBe(2000);
  });

  it("strips a children array from an income item — subcategories are expenses only", () => {
    const result = decodeJson(
      '{"incomes":[{"id":"p","name":"Salary","amount":1000,"frequency":"annual","children":[{"id":"c1","name":"Bonus","amount":500,"frequency":"annual"}]}],"expenses":[]}',
    );
    const [salary] = stateOf(result).incomes;
    expect(salary).not.toHaveProperty("children");
    expect(salary.amount).toBe(1000);
  });

  it("flattens away a grandchild — nesting is one level deep only", () => {
    const result = decodeJson(
      '{"incomes":[],"expenses":[{"id":"p","name":"Housing","amount":0,"frequency":"annual","children":[{"id":"c1","name":"Mortgage","amount":1500,"frequency":"annual","children":[{"id":"g1","name":"Escrow","amount":200,"frequency":"annual"}]}]}]}',
    );
    const [housing] = stateOf(result).expenses;
    expect(housing.children).toEqual([
      { id: "c1", name: "Mortgage", amount: 1500, frequency: "annual" },
    ]);
    expect(housing.children![0]).not.toHaveProperty("children");
  });
});

describe("describeLoadIssues", () => {
  it("returns null when nothing needed changing", () => {
    expect(describeLoadIssues(noIssues())).toBeNull();
  });

  it("describes each category of issue", () => {
    expect(
      describeLoadIssues({
        repaired: 2,
        droppedMalformed: 3,
        droppedNegative: 1,
        migrated: 4,
      }),
    ).toBe(
      "3 items could not be read, 1 item had a negative amount, 2 items were repaired, 4 items updated from an older link format.",
    );
  });

  it("uses singular wording for a single item", () => {
    expect(
      describeLoadIssues({
        repaired: 1,
        droppedMalformed: 0,
        droppedNegative: 0,
        migrated: 0,
      }),
    ).toBe("1 item was repaired.");
  });

  it("uses singular wording for a single migrated item", () => {
    expect(
      describeLoadIssues({
        repaired: 0,
        droppedMalformed: 0,
        droppedNegative: 0,
        migrated: 1,
      }),
    ).toBe("1 item updated from an older link format.");
  });

  it("mentions only the categories that occurred", () => {
    expect(
      describeLoadIssues({
        repaired: 0,
        droppedMalformed: 0,
        droppedNegative: 2,
        migrated: 0,
      }),
    ).toBe("2 items had a negative amount.");
  });

  it("uses saved-budget wording for a storage source, not link wording", () => {
    expect(
      describeLoadIssues(
        { repaired: 0, droppedMalformed: 0, droppedNegative: 0, migrated: 1 },
        "storage",
      ),
    ).toBe("1 item updated from an older saved budget format.");
  });
});

describe("encodeState failure", () => {
  it("returns null (not an empty string) when the state cannot be serialized", () => {
    const circular = { incomes: [], expenses: [] } as CashflowState & {
      self?: unknown;
    };
    circular.self = circular;
    expect(encodeState(circular)).toBeNull();
  });

  // Q6 (fixed in PR 1.1): an encode failure must not silently overwrite a
  // good URL with an empty one, and must stay distinguishable from an
  // absent parameter — updateUrlWithState now leaves the URL untouched.
  it("leaves the URL unchanged when encoding fails, rather than writing an empty data param", () => {
    const circular = { incomes: [], expenses: [] } as CashflowState & {
      self?: unknown;
    };
    circular.self = circular;

    const replaceState = stubWindow(SAMPLE_BUDGET_HREF);
    updateUrlWithState(circular);

    expect(replaceState).not.toHaveBeenCalled();
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
    expect(stateOf(getStateFromUrl())).toEqual(SAMPLE_BUDGET_MIGRATED);
  });

  it("also reads a link that arrives with only one layer of encoding", () => {
    // encodedOf writes raw JSON with no version field (unlike encodeOk,
    // which goes through encodeState and stamps one) — so, like the legacy
    // href, this is read as v1 and migrated.
    stubWindow(`https://cashkey.app/?data=${encodedOf(SAMPLE_BUDGET)}`);
    expect(stateOf(getStateFromUrl())).toEqual(SAMPLE_BUDGET_MIGRATED);
  });

  it("unwraps a doubly-encoded payload", () => {
    const doubled = encodeURIComponent(encodeOk(SAMPLE_BUDGET));
    expect(doubled.startsWith("%257B")).toBe(true);
    expect(stateOf(decodeState(doubled))).toEqual(SAMPLE_BUDGET);
  });

  it("unwraps a third encoding layer picked up in transit", () => {
    const doubled = encodeURIComponent(encodeOk(SAMPLE_BUDGET));
    stubWindow(`https://cashkey.app/?data=${encodeURIComponent(doubled)}`);
    expect(stateOf(getStateFromUrl())).toEqual(SAMPLE_BUDGET);
  });

  it("gives up rather than peeling forever", () => {
    let over = encodeOk(SAMPLE_BUDGET);
    for (let i = 0; i < 5; i += 1) over = encodeURIComponent(over);
    expect(decodeState(over)).toEqual({ status: "invalid", reason: "unreadable" });
  });

  it("does not decode a payload that is already plain JSON", () => {
    // Decoding first would turn "100%20 off" into "100 off" with no error
    // raised. Parsing first means an already-decoded payload is never touched.
    const state: CashflowState = {
      incomes: [{ id: "a", name: "100%20 off", amount: 1, frequency: "annual" }],
      expenses: [],
    };
    expect(stateOf(decodeState(JSON.stringify(state))).incomes[0].name).toBe(
      "100%20 off",
    );
  });

  it("survives a % in a name at one layer or two", () => {
    const state: CashflowState = {
      incomes: [{ id: "a", name: "50% Rule", amount: 1, frequency: "annual" }],
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
    expect(stateOf(getStateFromUrl())).toEqual(SAMPLE_BUDGET_MIGRATED);
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
    expect(stateOf(result)).toEqual(SAMPLE_BUDGET_MIGRATED);
    // Every item's emoji was migrated out of its name (16) and every item
    // also had frequency backfilled (16), so migrated is the only nonzero
    // issue count — nothing was repaired or dropped.
    expect(issuesOf(result)).toEqual({
      repaired: 0,
      droppedMalformed: 0,
      droppedNegative: 0,
      migrated: 32,
    });
  });

  it("preserves the figures the diagram depends on", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    const decoded = stateOf(getStateFromUrl());

    const total = (items: CashflowState["incomes"]) =>
      items.reduce((sum, item) => sum + item.amount, 0);
    expect(total(decoded.incomes)).toBe(60232);
    expect(total(decoded.expenses)).toBe(58981);
  });

  it("splits multi-codepoint emoji into the emoji field intact, not the name", () => {
    stubWindow(SAMPLE_BUDGET_HREF);
    const expenses = stateOf(getStateFromUrl()).expenses;

    // VARIATION_SELECTOR_NAMES is "<emoji> <name>"; the migration should
    // land the emoji (selector and all) in `emoji`, and the bare word in
    // `name` — never a name that still starts with the emoji.
    for (const combined of VARIATION_SELECTOR_NAMES) {
      const spaceIndex = combined.indexOf(" ");
      const emoji = combined.slice(0, spaceIndex);
      const name = combined.slice(spaceIndex + 1);
      const item = expenses.find((e) => e.name === name);
      expect(item?.emoji).toBe(emoji);
    }

    const housing = expenses.find((e) => e.name === "Housing");
    expect(housing?.emoji).toBe("🏡");
  });
});

describe("schema version envelope", () => {
  it("stamps the current schema version on every write", () => {
    const json = decodeURIComponent(encodeOk(SAMPLE_BUDGET));
    expect(JSON.parse(json).version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("round-trips the version through decodeState", () => {
    expect(stateOf(decodeState(encodeOk(SAMPLE_BUDGET)))).toEqual(SAMPLE_BUDGET);
  });

  it("treats a payload with no version field as v1 and migrates it forward", () => {
    // The 2,971-character fixture predates the version field entirely — this
    // is the permanent regression anchor every future migration must satisfy.
    // Since PR 1.2, "loads cleanly" means "migrates cleanly": every item's
    // emoji is detectable (16 migrated) and, since PR 1.3, every item also
    // gets frequency backfilled (16 more) — 32 total.
    stubWindow(SAMPLE_BUDGET_HREF);
    const result = getStateFromUrl();

    expect(stateOf(result)).toEqual(SAMPLE_BUDGET_MIGRATED);
    expect(issuesOf(result).migrated).toBe(32);
  });

  it("rejects a version newer than this build knows how to migrate", () => {
    const result = decodeJson('{"version":99,"incomes":[],"expenses":[]}');
    expect(result).toEqual({ status: "invalid", reason: "unsupported-version" });
  });

  it("does not run validation on an unsupported version's payload", () => {
    // A future shape could easily contain something that looks like today's
    // incomes/expenses arrays but means something else. It must never reach
    // validateItems.
    const result = decodeJson(
      '{"version":99,"incomes":[{"id":"x","name":"n","amount":1}],"expenses":[]}',
    );
    expect(result.status).toBe("invalid");
  });

  it("accepts a version equal to the current one", () => {
    const result = decodeJson(
      `{"version":${CURRENT_SCHEMA_VERSION},"incomes":[],"expenses":[]}`,
    );
    expect(result.status).toBe("loaded");
  });

  it("loads a v3 payload (no children field) cleanly with no registered v3 migration", () => {
    // R-DM-3 added an optional field, not a shape change to anything
    // existing — a v3 item is already valid v4 shape, so runMigrations'
    // pass-through for an unregistered version key is the whole migration.
    const result = decodeJson(
      '{"version":3,"incomes":[{"id":"i","name":"Salary","amount":1000,"frequency":"annual"}],"expenses":[{"id":"e","name":"Housing","amount":2000,"frequency":"annual"}]}',
    );
    expect(result.status).toBe("loaded");
    expect(issuesOf(result).migrated).toBe(0);
    expect(stateOf(result).expenses[0]).not.toHaveProperty("children");
  });
});

describe("runMigrations", () => {
  // Synthetic migrations, independent of any real schema change, so the
  // chaining mechanism is proven before PR 1.2/1.3 register real ones.
  const isTagged = (item: unknown) =>
    typeof item === "object" && item !== null && "tag" in item;

  const addTag = (record: Record<string, unknown>, issues: LoadIssues) => {
    const incomes = (Array.isArray(record.incomes) ? record.incomes : []).map(
      (item) => {
        if (isTagged(item)) return item;
        issues.migrated += 1;
        return { ...(item as object), tag: "v2" };
      },
    );
    return { ...record, incomes };
  };

  const stampRecordLevel = (record: Record<string, unknown>, issues: LoadIssues) => {
    issues.migrated += 1;
    return { ...record, globalStamp: true };
  };

  it("returns the record unchanged when fromVersion equals toVersion", () => {
    const record = { incomes: [], expenses: [] };
    const issues = noIssues();
    expect(runMigrations(record, 1, 1, { 1: addTag }, issues)).toBe(record);
    expect(issues.migrated).toBe(0);
  });

  it("runs a per-item migration and counts only the items it changes", () => {
    const record = {
      incomes: [{ id: "a" }, { id: "b", tag: "already" }],
      expenses: [],
    };
    const issues = noIssues();
    const migrated = runMigrations(record, 1, 2, { 1: addTag }, issues);

    expect((migrated.incomes as { tag?: string }[])[0].tag).toBe("v2");
    expect((migrated.incomes as { tag?: string }[])[1].tag).toBe("already");
    expect(issues.migrated).toBe(1);
  });

  it("chains a per-item migration into a record-level migration, v1→v2→v3", () => {
    const record = { incomes: [{ id: "a" }], expenses: [] };
    const issues = noIssues();
    const migrated = runMigrations(
      record,
      1,
      3,
      { 1: addTag, 2: stampRecordLevel },
      issues,
    );

    expect((migrated.incomes as { tag?: string }[])[0].tag).toBe("v2");
    expect(migrated.globalStamp).toBe(true);
    expect(issues.migrated).toBe(2);
  });

  it("skips a version with no registered migration", () => {
    const record = { incomes: [], expenses: [] };
    const issues = noIssues();
    expect(runMigrations(record, 1, 3, { 2: stampRecordLevel }, issues)).toEqual({
      ...record,
      globalStamp: true,
    });
    expect(issues.migrated).toBe(1);
  });
});

describe("migrated issue reporting", () => {
  it("is reported separately from repaired", () => {
    // With MIGRATIONS empty today, no production payload is old relative to
    // CURRENT_SCHEMA_VERSION, so this exercises describeLoadIssues's wording
    // directly rather than a real decodeState migration (see PR 1.2/1.3).
    const summary = describeLoadIssues({
      repaired: 1,
      droppedMalformed: 0,
      droppedNegative: 0,
      migrated: 3,
    });
    expect(summary).toBe("1 item was repaired, 3 items updated from an older link format.");
  });
});
