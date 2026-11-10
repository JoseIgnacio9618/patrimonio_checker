import { test } from "node:test";
import assert from "node:assert/strict";
import {
  savingsTax,
  settleSavings,
  taxReport,
  yearDefaults,
} from "../server/tax.js";
import { config, rules2026 as rules, tx } from "./tax-fixtures.js";
const annual = { "2026": rules };
const report = (
  rows: ReturnType<typeof tx>[],
  cfg = config(),
  year = 2026,
  profiles = annual,
) =>
  taxReport(
    rows,
    [{ asset: "ACME", date: "2026-11-10", price: "200" }],
    null,
    cfg,
    year,
    profiles,
    "2026-11-10",
  );
test("published progressive scales use cumulative upper bounds and both state/regional components", () => {
  for (const [base, quota] of [
    [0, 0],
    [6000, 1140],
    [50000, 10380],
    [200000, 44880],
    [300000, 71880],
    [400000, 101880],
  ])
    assert.equal(
      savingsTax(base, rules.stateBrackets)
        .plus(savingsTax(base, rules.regionalBrackets))
        .toNumber(),
      quota,
    );
  assert.equal(savingsTax(-500, rules.stateBrackets).toNumber(), 0);
});
test("current losses cross-offset up to the annual cap; prior balances are used oldest first with a shared cap", () => {
  const s = {
    ...structuredClone(yearDefaults),
    carry: [
      { year: 2020, capital: 99999, income: 99999 },
      { year: 2022, capital: 1000, income: 0 },
      { year: 2023, capital: 4000, income: 0 },
    ],
  };
  const result = settleSavings(-2000, 10000, s, 2026, rules);
  assert.equal(result.crossOffset, 2000);
  assert.equal(result.priorUsed, 500);
  assert.equal(result.base, 7500);
  assert.equal(result.quota, 1455);
  assert.deepEqual(result.remaining, [
    { year: 2022, capital: 500, income: 0, expires: 2026 },
    { year: 2023, capital: 4000, income: 0, expires: 2027 },
  ]);
  const reverse = settleSavings(10000, -3000, { ...s, carry: [] }, 2026, rules);
  assert.equal(reverse.base, 7500);
  assert.deepEqual(reverse.remaining, [
    { year: 2026, capital: 0, income: 500, expires: 2030 },
  ]);
});
test("prior losses in the same category are applied before cross compensation and minima remain separate", () => {
  const s = {
    ...structuredClone(yearDefaults),
    carry: [{ year: 2025, capital: 12000, income: 6000 }],
    minimumState: 1000,
    minimumRegional: 2000,
  };
  const result = settleSavings(10000, 10000, s, 2026, rules);
  assert.equal(result.base, 2000);
  assert.equal(result.priorUsed, 18000);
  assert.equal(result.quota, 95);
});
test("fiscal FIFO includes acquisition costs but sale withholding does not reduce the capital gain", () => {
  const c = config();
  c.years["2026"].withholdings = 19;
  const r = report(
    [
      tx({ id: "b1", quantity: "2", amount: "200", fee: "2", tax: "1" }),
      tx({ id: "b2", date: "2026-02-01", quantity: "1", amount: "150" }),
      tx({
        id: "s",
        date: "2026-03-01",
        type: "SELL",
        quantity: "2.5",
        amount: "500",
        fee: "1",
        tax: "19",
      }),
    ],
    c,
  );
  assert.equal(r.sales[0].cost, 278);
  assert.equal(r.sales[0].gain, 221);
  assert.equal(r.sales[0].proceeds, 499);
  assert.equal(r.settlement?.quota, 41.99);
  assert.equal(r.balanceAfterWithholding, 22.99);
  assert.equal(r.registeredWithholdings, 19);
});
test("year selection never falls back to another year and unconfirmed/foral/incomplete histories block quotas", () => {
  const rows = [
    tx({ id: "b" }),
    tx({ id: "s", date: "2026-06-01", type: "SELL", amount: "200" }),
  ];
  assert.equal(report(rows, config(), 2025).settlement, null);
  for (const regime of ["unconfirmed", "foral", "nonresident"] as const) {
    const c = config();
    c.years["2026"].regime = regime;
    assert.equal(report(rows, c).complete, false);
  }
  const c = config();
  c.years["2026"].historyComplete = false;
  assert.equal(report(rows, c).settlement, null);
  const different = {
    ...rules,
    year: 2025,
    stateBrackets: [{ upTo: null, rate: 0.05 }],
    regionalBrackets: [{ upTo: null, rate: 0.05 }],
  };
  c.years["2025"] = { ...c.years["2026"], historyComplete: true };
  const oldRows = rows.map((t) => ({
    ...t,
    date: t.date.replace("2026", "2025"),
  }));
  assert.equal(
    report(oldRows, c, 2025, {
      "2026": rules,
      "2025": different,
    } as typeof annual).settlement?.quota,
    10,
  );
  assert.equal(report(rows).settlement?.quota, 19);
});
test("transferred assets require original total cost and original date; older lots precede local purchases", () => {
  const rows = [
    tx({ id: "b", date: "2026-01-01", amount: "100" }),
    tx({
      id: "in",
      date: "2026-02-01",
      type: "TRANSFER_IN",
      amount: "200",
      costBasis: "50",
      acquisitionDate: "2020-01-01",
    }),
    tx({ id: "s", date: "2026-03-01", type: "SELL", amount: "150" }),
  ];
  assert.equal(report(rows).sales[0].cost, 50);
  assert.equal(report(rows).sales[0].gain, 100);
  const unknown = rows.map((t) =>
    t.id === "in" ? { ...t, acquisitionDate: null } : t,
  );
  assert.equal(report(unknown).sales[0].deductible, null); // Unknown original dates can change the ordering of all remaining lots.
  assert.equal(
    report(
      [rows[1], rows[2]].map((t) =>
        t.id === "in" ? { ...t, acquisitionDate: null } : t,
      ),
    ).settlement,
    null,
  );
  assert.equal(
    report(
      [rows[1], rows[2]].map((t) =>
        t.id === "in" ? { ...t, costBasis: null } : t,
      ),
    ).settlement,
    null,
  );
  assert.equal(
    report([tx({ id: "b", date: "1990-01-01" }), rows[2]]).settlement,
    null,
  );
});
test("losses in a repurchase window stay pending until reviewed; impossible deductible amounts are rejected", () => {
  const rows = [
    tx({ id: "b", date: "2025-01-01" }),
    tx({ id: "s", date: "2026-10-01", type: "SELL", amount: "50" }),
    tx({ id: "again", date: "2026-10-05" }),
  ];
  assert.equal(report(rows).sales[0].deductible, null);
  assert.equal(report(rows).settlement, null);
  const c = config();
  c.years["2026"].deductibleLosses["s"] = 0;
  assert.equal(report(rows, c).sales[0].deferred, 50);
  assert.equal(report(rows, c).projections[0].additionalTax, null);
  c.years["2026"].deductibleLosses["s"] = 60;
  assert.match(report(rows, c).sales[0].reason!, /supera/);
  const closed = [
    tx({ id: "b", date: "2025-01-01" }),
    tx({ id: "s", date: "2026-01-01", type: "SELL", amount: "50" }),
  ];
  assert.equal(report(closed).sales[0].deductible, -50);
  const crypto = closed.map((t) => ({ ...t, category: "CRYPTO" as const }));
  assert.match(report(crypto).sales[0].reason!, /cripto/);
});
test("debt goes to investment income and uncertain asset types/Saveback do not silently produce a total", () => {
  const rows = [
    tx({ id: "b", category: "BOND" }),
    tx({
      id: "s",
      category: "BOND",
      date: "2026-06-01",
      type: "SELL",
      amount: "200",
    }),
  ];
  const r = report(rows);
  assert.equal(r.sales[0].bucket, "income");
  assert.equal(r.income, 100);
  assert.equal(r.salesTax, 19);
  assert.equal(
    report(rows.map((t) => ({ ...t, category: "GOLD" as const }))).settlement,
    null,
  );
  const c = config();
  c.years["2026"].saveback = "review";
  assert.equal(
    report([tx({ type: "SAVEBACK", quantity: "0", amount: "5" })], c)
      .settlement,
    null,
  );
});
test("sell projections are marginal to the current year and joint liquidation crosses tax brackets once", () => {
  const c = config();
  c.saleFee = 0;
  const r = taxReport(
    [
      tx({ id: "a", amount: "100" }),
      tx({ id: "b", asset: "SECOND", amount: "100" }),
    ],
    [
      { asset: "ACME", date: "2026-11-10", price: "4100" },
      { asset: "SECOND", date: "2026-11-10", price: "4100" },
    ],
    null,
    c,
    2026,
    annual,
    "2026-11-10",
  );
  assert.deepEqual(
    r.projections.map((p) => p.additionalTax),
    [760, 760],
  );
  assert.equal(r.liquidationTax, 1560);
  assert.equal(
    taxReport(
      [tx({})],
      [{ asset: "ACME", date: "2026-01-01", price: "200" }],
      null,
      c,
      2026,
      annual,
      "2026-11-10",
    ).projections[0].additionalTax,
    null,
  );
  const foreignReport = taxReport(
    [tx({})],
    [{ asset: "ACME", date: "2026-11-10", price: "200" }],
    null,
    c,
    2025,
    { "2025": { ...rules, year: 2025 } },
    "2026-11-10",
  );
  assert.equal(foreignReport.projections[0].additionalTax, null);
});
