import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { annualRulesSchema, rulesFingerprint } from "../server/tax-rules.js";
import { config, rules2026 as rules } from "./tax-fixtures.js";
const header = ["X-Patrimonio", "local"] as const;
test("annual JSON validation rejects malformed scales, fractions, unofficial sources, future dates, unknown fields and models", () => {
  assert.equal(annualRulesSchema.safeParse(rules).success, true);
  const invalid = [
    { ...rules, stateBrackets: [{ upTo: 6000, rate: 0.095 }] },
    { ...rules, stateBrackets: [{ upTo: null, rate: 9.5 }] },
    {
      ...rules,
      stateBrackets: [
        { upTo: 6000, rate: 0.2 },
        { upTo: 5000, rate: 0.3 },
        { upTo: null, rate: 0.4 },
      ],
    },
    {
      ...rules,
      stateBrackets: [
        { upTo: null, rate: 0.1 },
        { upTo: null, rate: 0.2 },
      ],
    },
    {
      ...rules,
      stateBrackets: [
        { upTo: 6000, rate: 0.2 },
        { upTo: null, rate: 0.1 },
      ],
    },
    { ...rules, verifiedAt: "2100-01-01" },
    {
      ...rules,
      sources: [{ title: "Fake", url: "https://boe.es.evil.example/a" }],
    },
    {
      ...rules,
      sources: [{ title: "Fake", url: "https://boe.es@evil.example/a" }],
    },
    { ...rules, sources: [{ title: "HTTP", url: "http://www.boe.es/a" }] },
    { ...rules, model: "execute-js", script: "alert(1)" },
    { ...rules, unexpected: 5 },
  ];
  for (const input of invalid)
    assert.equal(annualRulesSchema.safeParse(input).success, false);
});
test("prompt asks for the selected year without portfolio information; preview does not activate; year/review/hash guards apply", async (t) => {
  const s = new Store(":memory:");
  t.after(() => s.close());
  const api = request(createApp(s));
  await api.get("/api/tax").expect(400);
  const prompt = await api.get("/api/tax/prompt?year=2025").expect(200);
  assert.match(prompt.body.prompt, /EJERCICIO 2025/);
  assert.match(prompt.body.prompt, /2026/);
  assert.match(prompt.body.prompt, /No copies automáticamente/);
  const schema = await api.get("/api/tax/schema").expect(200);
  assert.match(schema.headers["content-disposition"], /esquema/);
  const preview = await api
    .post("/api/tax/rules/preview")
    .set(...header)
    .send({ year: 2026, rules })
    .expect(200);
  assert.deepEqual(s.taxRules(), {});
  await api
    .post("/api/tax/rules/preview")
    .set(...header)
    .send({ year: 2025, rules })
    .expect(400);
  await api
    .post("/api/tax/rules/activate")
    .set(...header)
    .send({ year: 2026, ...preview.body })
    .expect(400);
  await api
    .post("/api/tax/rules/activate")
    .set(...header)
    .send({
      year: 2026,
      ...preview.body,
      reviewed: true,
      rules: { ...rules, crossOffsetLimit: 0.5 },
    })
    .expect(400);
  await api
    .post("/api/tax/rules/activate")
    .set(...header)
    .send({ year: 2026, ...preview.body, reviewed: true })
    .expect(200);
  assert.equal(s.taxRules()["2026"].year, 2026);
  const missing = await api.get("/api/tax?year=2025").expect(200);
  assert.equal(missing.body.rules, null);
  assert.equal(missing.body.complete, false);
  const unconfirmed = await api.get("/api/tax?year=2026").expect(200);
  assert.equal(unconfirmed.body.complete, false);
  await api
    .post("/api/tax/config")
    .set(...header)
    .send(config())
    .expect(200);
  const ready = await api.get("/api/tax?year=2026").expect(200);
  assert.equal(ready.body.complete, true);
  const cfg = config();
  cfg.years["2025"] = { ...cfg.years["2026"], withholdings: 50 };
  await api
    .post("/api/tax/config")
    .set(...header)
    .send(cfg)
    .expect(200);
  assert.equal(
    (await api.get("/api/tax?year=2026")).body.settings.withholdings,
    null,
  );
});
test("fiscal profiles are versioned, demo changes isolated, and validated backup preserves every version and original acquisition date", async (t) => {
  const s = new Store(":memory:"),
    s2 = new Store(":memory:"),
    s3 = new Store(":memory:");
  t.after(() => {
    s.close();
    s2.close();
    s3.close();
  });
  const api = request(createApp(s)),
    api2 = request(createApp(s2));
  for (const version of [
    rules,
    { ...rules, notes: ["Revisión posterior de las fuentes"] },
  ]) {
    const preview = await api
      .post("/api/tax/rules/preview")
      .set(...header)
      .send({ year: 2026, rules: version })
      .expect(200);
    await api
      .post("/api/tax/rules/activate")
      .set(...header)
      .send({ year: 2026, ...preview.body, reviewed: true })
      .expect(200);
  }
  assert.equal(
    (await api.get("/api/tax/rules?year=2026")).body.versions.length,
    2,
  );
  await api
    .post("/api/tax/config")
    .set(...header)
    .send(config())
    .expect(200);
  const demoConfig = config();
  demoConfig.years["2026"].otherIncome = 123456;
  await api
    .post("/api/tax/config?demo=1")
    .set(...header)
    .send(demoConfig)
    .expect(200);
  assert.equal(s.setting("taxConfig", config()).years["2026"].otherIncome, 0);
  await api
    .post("/api/import/commit")
    .set(...header)
    .send({
      csv: "id,date,type,asset,quantity,amount,costBasis,acquisitionDate\ndep,2025-01-01,DEPOSIT,,0,1000,,\nin,2026-01-01,TRANSFER_IN,BTC,0.01,900,300,2020-01-01",
    })
    .expect(200);
  const csv = await api.get("/api/export/transactions").expect(200);
  assert.match(csv.text, /acquisitionDate/);
  assert.match(csv.text, /2020-01-01/);
  const backup = (await api.get("/api/export/backup").expect(200)).body;
  assert.equal(backup.version, 3);
  assert.equal(backup.taxVersions.length, 2);
  await api2
    .post("/api/restore")
    .set(...header)
    .send(backup)
    .expect(200);
  assert.deepEqual(s2.taxRules(), s.taxRules());
  assert.deepEqual(s2.setting("taxConfig", null), s.setting("taxConfig", null));
  assert.deepEqual(s2.transactions(), s.transactions());
  assert.equal(
    (await api2.get("/api/tax/rules?year=2026")).body.versions.length,
    2,
  );
  const tampered = {
    ...backup,
    taxActive: { "2025": rulesFingerprint(rules) },
  };
  await request(createApp(s3))
    .post("/api/restore")
    .set(...header)
    .send(tampered)
    .expect(400);
  assert.equal(s3.transactions().length, 0);
});

test("CSV enrichment adds original lot metadata once and refuses conflicting fiscal costs or acquisition dates", async (t) => {
  const s = new Store(":memory:");
  t.after(() => s.close());
  const api = request(createApp(s));
  const csv =
    "id,date,type,asset,quantity,amount,costBasis,acquisitionDate\nin,2026-01-01,TRANSFER_IN,BTC,1,900,";
  await api
    .post("/api/import/commit")
    .set(...header)
    .send({ csv: csv + "," })
    .expect(200);
  const enriched = await api
    .post("/api/import/commit")
    .set(...header)
    .send({ csv: csv + "300,2020-01-01" })
    .expect(200);
  assert.equal(enriched.body.added, 0);
  assert.equal(s.transactions()[0].costBasis, "300");
  assert.equal(s.transactions()[0].acquisitionDate, "2020-01-01");
  await api
    .post("/api/import/commit")
    .set(...header)
    .send({ csv: csv + "400,2020-01-01" })
    .expect(422);
  await api
    .post("/api/import/commit")
    .set(...header)
    .send({ csv: csv + "300,2021-01-01" })
    .expect(422);
  assert.equal(s.transactions()[0].acquisitionDate, "2020-01-01");
  await api
    .post("/api/import/commit")
    .set(...header)
    .send({ csv: csv + "300,2027-01-01" })
    .expect(422);
});
