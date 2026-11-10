import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaxComponent } from "./tax.component";
const settings = {
  regime: "unconfirmed",
  historyComplete: false,
  saveback: "review",
  otherIncome: 0,
  otherGains: 0,
  releasedLosses: 0,
  minimumState: 0,
  minimumRegional: 0,
  withholdings: null,
  carry: [],
  deductibleLosses: {},
};
const report = {
  year: 2025,
  filingYear: 2026,
  projectionYear: 2026,
  asOf: "2026-11-10",
  config: { saleFee: 1, assetKinds: {}, years: {} },
  settings,
  availableAssets: [],
  sales: [],
  knownGains: 0,
  knownLosses: 0,
  income: 0,
  registeredWithholdings: 0,
  complete: false,
  settlement: null,
  salesTax: null,
  balanceAfterWithholding: null,
  projections: [],
  liquidationTax: null,
  warnings: [],
  rules: null,
  sources: [],
};
describe("annual fiscal file workflow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("/prompt?")
          ? { prompt: "Investigar EJERCICIO 2025" }
          : structuredClone(report),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await TestBed.configureTestingModule({
      imports: [TaxComponent],
    }).compileComponents();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });
  it("asks for the exercise before any request and leaves regime unconfirmed", async () => {
    const f = TestBed.createComponent(TaxComponent);
    f.detectChanges();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain(
      "¿Qué ejercicio quieres revisar?",
    );
    await f.componentInstance.openYear();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.componentInstance.error()).toContain("Indica un ejercicio");
    f.componentInstance.year = 2025;
    await f.componentInstance.openYear();
    f.detectChanges();
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      "/api/tax?year=2025&demo=0",
      "/api/tax/prompt?year=2025&demo=0",
    ]);
    expect(f.componentInstance.settings.regime).toBe("unconfirmed");
    expect(f.nativeElement.textContent).toContain("Falta normativa anual");
    expect(f.nativeElement.textContent).toContain("Copiar prompt para la IA");
  });
  it("a rejected AI file clears the old preview and never requests activation", async () => {
    const f = TestBed.createComponent(TaxComponent),
      c = f.componentInstance;
    c.year = 2025;
    await c.openYear();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Datos inválidos", details: ["rules.year"] }),
    });
    const input = {
      files: [
        {
          size: 10,
          arrayBuffer: async () =>
            new TextEncoder().encode('{"year":2024}').buffer,
        },
      ],
      value: "file.json",
    };
    await c.readRules({ target: input } as unknown as Event);
    expect(c.error()).toContain("rules.year");
    expect(c.pending()).toBeNull();
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("/activate")),
    ).toBe(false);
    expect(input.value).toBe("");
  });
  it("switching datasets discards an in-flight response from the previous account view", async () => {
    const f = TestBed.createComponent(TaxComponent),
      c = f.componentInstance;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchMock.mockImplementation(async () => {
      await gate;
      return { ok: true, json: async () => structuredClone(report) };
    });
    c.year = 2025;
    const loading = c.openYear();
    c.demo = true;
    c.ngOnChanges();
    release();
    await loading;
    expect(c.report()).toBeNull();
    expect(c.openedYear()).toBeNull();
    expect(c.error()).toBe("");
  });
});
