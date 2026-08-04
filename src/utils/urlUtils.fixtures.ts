import type { CashflowState } from "@/types/cashflow";

// Characterization fixtures for PR 0.2. These describe URL serialization as it
// behaves TODAY, before the Phase 1 schema changes. Every subsequent PR that
// touches serialization must keep these loading — see the definition of done in
// docs/requirements/IMPLEMENTATION-PLAN.md.
//
// Generated from the real sample budget in src/pages/Index.tsx, with stable ids
// substituted for crypto.randomUUID(). Do not hand-edit the encoded string.

/**
 * The 16-item sample budget, exactly as Index.tsx seeds it. `frequency:
 * "annual"` on every item reflects reality, not a stand-in: pre-PR-1.3, the
 * app only ever stored annual amounts (see the v2->v3 migration comment in
 * urlUtils.ts), so this is what every item's frequency has always actually
 * been.
 */
export const SAMPLE_BUDGET: CashflowState = {
  incomes: [
    { id: "9f1c0a3e-1b2d-4c5e-8f70-a1b2c3d4e5f6", name: "💵 Paycheck", amount: 54132, frequency: "annual" },
    { id: "2a7b4c6d-8e9f-4a1b-9c2d-3e4f5a6b7c8d", name: "💰 Side Gig", amount: 5000, frequency: "annual" },
    { id: "5c3d1e7f-6a8b-49c0-b1d2-e3f4a5b6c7d8", name: "🤑 Interest", amount: 500, frequency: "annual" },
    { id: "8e6f2a4b-3c5d-4e7f-a890-b1c2d3e4f5a6", name: "📈 Dividends", amount: 500, frequency: "annual" },
    { id: "1b9d7e5c-4a3f-4b8e-9d0c-f1a2b3c4d5e6", name: "💳 Credit Card Cashback", amount: 100, frequency: "annual" },
  ],
  expenses: [
    { id: "3f8a1c9e-7d2b-4f6a-8c1e-9b0d2f4a6c8e", name: "🏡 Housing", amount: 16608, frequency: "annual" },
    { id: "6d2e8b4f-1a9c-4d3e-b7f0-2c4e6a8b0d2f", name: "🍔 Food", amount: 8172, frequency: "annual" },
    { id: "9a4c6e8b-2d1f-4a7c-9e3b-5f7a9c1e3b5d", name: "🏥 Healthcare", amount: 7610, frequency: "annual" },
    { id: "4b7d9f1a-5c3e-4b9d-8a2f-6c8e0a2c4e6b", name: "🚙 Transportation", amount: 5676, frequency: "annual" },
    { id: "7e1a3c5d-9b7f-4e1a-b3c5-d7f9a1c3e5b7", name: "🎓 Education", amount: 5000, frequency: "annual" },
    { id: "2c5e7a9b-4d6f-4c8a-9b1d-3e5a7c9e1b3d", name: "🏝️ Vacation", amount: 4940, frequency: "annual" },
    { id: "5a8c0e2b-7f9d-4a2c-8e0b-4d6f8a0c2e4b", name: "💡 Utilities", amount: 4475, frequency: "annual" },
    { id: "8d0f2b4c-1e3a-4d5f-9b7c-5a7c9e1b3d5f", name: "🛍️ Shopping", amount: 3000, frequency: "annual" },
    { id: "1f3b5d7a-8c0e-4f2b-a4d6-6b8d0f2a4c6e", name: "🎭 Entertainment", amount: 1500, frequency: "annual" },
    { id: "4a6c8e0d-2b4f-4a6c-b8e0-7c9e1a3c5e7a", name: "🎁 Gifts", amount: 1000, frequency: "annual" },
    { id: "7c9e1b3d-5a7f-4c9e-8b0d-8d0f2b4d6f8a", name: "🎗️ Charity", amount: 1000, frequency: "annual" },
  ],
};

/**
 * A full share link as the app writes it today: 2971 characters.
 *
 * Note the TWO layers of percent-encoding — `%257B` rather than `%7B` for
 * the opening brace. encodeState() percent-encodes the JSON, then
 * URLSearchParams.set() encodes the resulting `%` signs again. This is what
 * lands in the address bar and in every link ever shared.
 */
export const SAMPLE_BUDGET_HREF =
  "https://cashkey.app/?data=%257B%2522incomes%2522%253A%255B%257B%2522id%2522%253A%25229f1c0a3e-1b2d-4c5e-8f70-a1b2c3d4e5f6%2522%252C%2522name%2522%253A%2522%25F0%259F%2592%25B5%2520Paycheck%2522%252C%2522amount%2522%253A54132%257D%252C%257B%2522id%2522%253A%25222a7b4c6d-8e9f-4a1b-9c2d-3e4f5a6b7c8d%2522%252C%2522name%2522%253A%2522%25F0%259F%2592%25B0%2520Side%2520Gig%2522%252C%2522amount%2522%253A5000%257D%252C%257B%2522id%2522%253A%25225c3d1e7f-6a8b-49c0-b1d2-e3f4a5b6c7d8%2522%252C%2522name%2522%253A%2522%25F0%259F%25A4%2591%2520Interest%2522%252C%2522amount%2522%253A500%257D%252C%257B%2522id%2522%253A%25228e6f2a4b-3c5d-4e7f-a890-b1c2d3e4f5a6%2522%252C%2522name%2522%253A%2522%25F0%259F%2593%2588%2520Dividends%2522%252C%2522amount%2522%253A500%257D%252C%257B%2522id%2522%253A%25221b9d7e5c-4a3f-4b8e-9d0c-f1a2b3c4d5e6%2522%252C%2522name%2522%253A%2522%25F0%259F%2592%25B3%2520Credit%2520Card%2520Cashback%2522%252C%2522amount%2522%253A100%257D%255D%252C%2522expenses%2522%253A%255B%257B%2522id%2522%253A%25223f8a1c9e-7d2b-4f6a-8c1e-9b0d2f4a6c8e%2522%252C%2522name%2522%253A%2522%25F0%259F%258F%25A1%2520Housing%2522%252C%2522amount%2522%253A16608%257D%252C%257B%2522id%2522%253A%25226d2e8b4f-1a9c-4d3e-b7f0-2c4e6a8b0d2f%2522%252C%2522name%2522%253A%2522%25F0%259F%258D%2594%2520Food%2522%252C%2522amount%2522%253A8172%257D%252C%257B%2522id%2522%253A%25229a4c6e8b-2d1f-4a7c-9e3b-5f7a9c1e3b5d%2522%252C%2522name%2522%253A%2522%25F0%259F%258F%25A5%2520Healthcare%2522%252C%2522amount%2522%253A7610%257D%252C%257B%2522id%2522%253A%25224b7d9f1a-5c3e-4b9d-8a2f-6c8e0a2c4e6b%2522%252C%2522name%2522%253A%2522%25F0%259F%259A%2599%2520Transportation%2522%252C%2522amount%2522%253A5676%257D%252C%257B%2522id%2522%253A%25227e1a3c5d-9b7f-4e1a-b3c5-d7f9a1c3e5b7%2522%252C%2522name%2522%253A%2522%25F0%259F%258E%2593%2520Education%2522%252C%2522amount%2522%253A5000%257D%252C%257B%2522id%2522%253A%25222c5e7a9b-4d6f-4c8a-9b1d-3e5a7c9e1b3d%2522%252C%2522name%2522%253A%2522%25F0%259F%258F%259D%25EF%25B8%258F%2520Vacation%2522%252C%2522amount%2522%253A4940%257D%252C%257B%2522id%2522%253A%25225a8c0e2b-7f9d-4a2c-8e0b-4d6f8a0c2e4b%2522%252C%2522name%2522%253A%2522%25F0%259F%2592%25A1%2520Utilities%2522%252C%2522amount%2522%253A4475%257D%252C%257B%2522id%2522%253A%25228d0f2b4c-1e3a-4d5f-9b7c-5a7c9e1b3d5f%2522%252C%2522name%2522%253A%2522%25F0%259F%259B%258D%25EF%25B8%258F%2520Shopping%2522%252C%2522amount%2522%253A3000%257D%252C%257B%2522id%2522%253A%25221f3b5d7a-8c0e-4f2b-a4d6-6b8d0f2a4c6e%2522%252C%2522name%2522%253A%2522%25F0%259F%258E%25AD%2520Entertainment%2522%252C%2522amount%2522%253A1500%257D%252C%257B%2522id%2522%253A%25224a6c8e0d-2b4f-4a6c-b8e0-7c9e1a3c5e7a%2522%252C%2522name%2522%253A%2522%25F0%259F%258E%2581%2520Gifts%2522%252C%2522amount%2522%253A1000%257D%252C%257B%2522id%2522%253A%25227c9e1b3d-5a7f-4c9e-8b0d-8d0f2b4d6f8a%2522%252C%2522name%2522%253A%2522%25F0%259F%258E%2597%25EF%25B8%258F%2520Charity%2522%252C%2522amount%2522%253A1000%257D%255D%257D";

/**
 * Names carrying multi-codepoint emoji. Each is a base emoji followed by
 * VARIATION SELECTOR-16 (U+FE0F), which encodes as %EF%B8%8F — and as
 * %25EF%25B8%258F once the second layer is applied. PR 1.2 extracts emoji
 * into their own field and must not split these.
 */
export const VARIATION_SELECTOR_NAMES = [
  "🏝️ Vacation",
  "🛍️ Shopping",
  "🎗️ Charity",
] as const;

/**
 * The expected result of running the full migration chain (PR 1.2's emoji
 * split, then PR 1.3's frequency backfill) over SAMPLE_BUDGET_HREF, a v1
 * payload with neither field. Written out by hand, item by item, rather than
 * derived by calling the migrations on SAMPLE_BUDGET — a fixture produced by
 * the code under test would only ever prove the migrations agree with
 * themselves. Ids and amounts are unchanged from SAMPLE_BUDGET; every `name`
 * had its leading emoji split into `emoji` (every item in the sample data is
 * in the detectable "emoji, space, text" shape), and every item gets
 * `frequency: "annual"` backfilled since the payload predates the field
 * entirely — see the migration comment in urlUtils.ts on why that backfill
 * is a documented assumption, not recovered intent.
 */
export const SAMPLE_BUDGET_MIGRATED: CashflowState = {
  incomes: [
    { id: "9f1c0a3e-1b2d-4c5e-8f70-a1b2c3d4e5f6", emoji: "💵", name: "Paycheck", amount: 54132, frequency: "annual" },
    { id: "2a7b4c6d-8e9f-4a1b-9c2d-3e4f5a6b7c8d", emoji: "💰", name: "Side Gig", amount: 5000, frequency: "annual" },
    { id: "5c3d1e7f-6a8b-49c0-b1d2-e3f4a5b6c7d8", emoji: "🤑", name: "Interest", amount: 500, frequency: "annual" },
    { id: "8e6f2a4b-3c5d-4e7f-a890-b1c2d3e4f5a6", emoji: "📈", name: "Dividends", amount: 500, frequency: "annual" },
    {
      id: "1b9d7e5c-4a3f-4b8e-9d0c-f1a2b3c4d5e6",
      emoji: "💳",
      name: "Credit Card Cashback",
      amount: 100,
      frequency: "annual",
    },
  ],
  expenses: [
    { id: "3f8a1c9e-7d2b-4f6a-8c1e-9b0d2f4a6c8e", emoji: "🏡", name: "Housing", amount: 16608, frequency: "annual" },
    { id: "6d2e8b4f-1a9c-4d3e-b7f0-2c4e6a8b0d2f", emoji: "🍔", name: "Food", amount: 8172, frequency: "annual" },
    { id: "9a4c6e8b-2d1f-4a7c-9e3b-5f7a9c1e3b5d", emoji: "🏥", name: "Healthcare", amount: 7610, frequency: "annual" },
    {
      id: "4b7d9f1a-5c3e-4b9d-8a2f-6c8e0a2c4e6b",
      emoji: "🚙",
      name: "Transportation",
      amount: 5676,
      frequency: "annual",
    },
    { id: "7e1a3c5d-9b7f-4e1a-b3c5-d7f9a1c3e5b7", emoji: "🎓", name: "Education", amount: 5000, frequency: "annual" },
    { id: "2c5e7a9b-4d6f-4c8a-9b1d-3e5a7c9e1b3d", emoji: "🏝️", name: "Vacation", amount: 4940, frequency: "annual" },
    { id: "5a8c0e2b-7f9d-4a2c-8e0b-4d6f8a0c2e4b", emoji: "💡", name: "Utilities", amount: 4475, frequency: "annual" },
    { id: "8d0f2b4c-1e3a-4d5f-9b7c-5a7c9e1b3d5f", emoji: "🛍️", name: "Shopping", amount: 3000, frequency: "annual" },
    {
      id: "1f3b5d7a-8c0e-4f2b-a4d6-6b8d0f2a4c6e",
      emoji: "🎭",
      name: "Entertainment",
      amount: 1500,
      frequency: "annual",
    },
    { id: "4a6c8e0d-2b4f-4a6c-b8e0-7c9e1a3c5e7a", emoji: "🎁", name: "Gifts", amount: 1000, frequency: "annual" },
    { id: "7c9e1b3d-5a7f-4c9e-8b0d-8d0f2b4d6f8a", emoji: "🎗️", name: "Charity", amount: 1000, frequency: "annual" },
  ],
};
