import { Component, Input, OnChanges, OnDestroy, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type {
  AnnualTaxRules,
  TaxConfig,
  TaxKind,
  TaxReport,
  TaxSale,
  TaxYearSettings,
} from "../shared/tax";
const yearSettings = (): TaxYearSettings => ({
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
});
@Component({
  selector: "app-tax",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./tax.component.html",
})
export class TaxComponent implements OnChanges, OnDestroy {
  private epoch = 0;
  ngOnDestroy() {
    this.epoch++;
  }
  @Input() demo = false;
  year: number | null = null;
  openedYear = signal<number | null>(null);
  report = signal<TaxReport | null>(null);
  pending = signal<{ rules: AnnualTaxRules; fingerprint: string } | null>(null);
  prompt = signal("");
  busy = signal(false);
  error = signal("");
  notice = signal("");
  config: TaxConfig = { saleFee: 1, assetKinds: {}, years: {} };
  settings = yearSettings();
  readonly kinds: { value: TaxKind; label: string }[] = [
    { value: "listed", label: "Valor o participación cotizada" },
    { value: "unlisted", label: "Valor o fondo no cotizado" },
    { value: "crypto", label: "Criptomoneda" },
    { value: "debt", label: "Activo financiero de deuda" },
    { value: "other", label: "Otro elemento patrimonial" },
    { value: "unknown", label: "Pendiente de clasificar" },
  ];
  ngOnChanges() {
    this.epoch++;
    this.busy.set(false);
    this.error.set("");
    this.notice.set("");
    this.year = null;
    this.openedYear.set(null);
    this.report.set(null);
    this.pending.set(null);
    this.prompt.set("");
  }
  money(value: number | null | undefined) {
    return value == null
      ? "—"
      : new Intl.NumberFormat("es-ES", {
          style: "currency",
          currency: "EUR",
        }).format(value);
  }
  percent(n: number) {
    return new Intl.NumberFormat("es-ES", {
      style: "percent",
      maximumFractionDigits: 3,
    }).format(n);
  }
  number(n: number) {
    return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 8 }).format(
      n,
    );
  }
  async api<T>(path: string, body?: unknown): Promise<T> {
    const epoch = this.epoch;
    const r = await fetch(
      `/api/tax${path}${path.includes("?") ? "&" : "?"}demo=${this.demo ? "1" : "0"}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? {}
            : { "Content-Type": "application/json", "X-Patrimonio": "local" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const data = await r.json();
    if (epoch !== this.epoch) throw new Error("Vista cambiada");
    if (!r.ok)
      throw new Error([data.error, ...(data.details ?? [])].join(" · "));
    return data;
  }
  async run(fn: () => Promise<void>) {
    const epoch = this.epoch;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await fn();
    } catch (e) {
      if (epoch === this.epoch) this.error.set((e as Error).message);
    } finally {
      if (epoch === this.epoch) this.busy.set(false);
    }
  }
  async openYear() {
    await this.run(async () => {
      if (
        !Number.isInteger(this.year) ||
        this.year! < 2010 ||
        this.year! > 2100
      )
        throw new Error("Indica un ejercicio entre 2010 y 2100");
      const year = this.year;
      this.pending.set(null);
      this.openedYear.set(null);
      this.report.set(null);
      const [report, prompt] = await Promise.all([
        this.api<TaxReport>(`?year=${year}`),
        this.api<{ prompt: string }>(`/prompt?year=${year}`),
      ]);
      this.report.set(report);
      this.config = structuredClone(report.config);
      this.settings = structuredClone(report.settings);
      this.config.years[String(year)] = this.settings;
      this.prompt.set(prompt.prompt);
      this.openedYear.set(year);
    });
  }
  async copyPrompt() {
    await this.run(async () => {
      try {
        await navigator.clipboard.writeText(this.prompt());
        this.notice.set(
          "Prompt copiado. Pégalo en una IA con acceso a fuentes oficiales y pide el fichero JSON.",
        );
      } catch {
        this.notice.set(
          "Abre «Ver prompt completo», selecciona el texto y cópialo con tu teclado.",
        );
      }
    });
  }
  async readRules(event: Event) {
    const epoch = this.epoch,
      input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    await this.run(async () => {
      this.pending.set(null);
      if (file.size > 500000)
        throw new Error("El fichero de normativa no debe superar 500 KB");
      const rules = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      );
      if (epoch !== this.epoch) return;
      this.pending.set(
        await this.api("/rules/preview", { year: this.openedYear(), rules }),
      );
      this.notice.set(
        "Formato validado. Revisa los datos y sus fuentes antes de activar el perfil.",
      );
    });
    input.value = "";
  }
  async activate() {
    await this.run(async () => {
      const p = this.pending();
      if (!p) return;
      await this.api("/rules/activate", {
        year: this.openedYear(),
        ...p,
        reviewed: true,
      });
      this.pending.set(null);
      this.report.set(await this.api<TaxReport>(`?year=${this.openedYear()}`));
      this.notice.set(
        `Normativa del ejercicio ${this.openedYear()} activada. Se conserva la versión anterior.`,
      );
    });
  }
  async saveSettings() {
    await this.run(async () => {
      if (!this.openedYear()) return;
      this.config.years[String(this.openedYear())] = this.settings;
      await this.api("/config", this.config);
      this.report.set(await this.api<TaxReport>(`?year=${this.openedYear()}`));
      this.notice.set(
        "Datos fiscales del ejercicio guardados y estimaciones recalculadas.",
      );
    });
  }
  addCarry() {
    this.settings.carry.push({
      year: (this.openedYear() ?? new Date().getFullYear()) - 1,
      capital: 0,
      income: 0,
    });
  }
  reviewLoss(sale: TaxSale) {
    return (
      sale.gain !== null &&
      sale.gain < 0 &&
      (Object.hasOwn(this.settings.deductibleLosses, sale.id) ||
        (!!sale.reason && /recompra|cripto/i.test(sale.reason)))
    );
  }
  kindLabel(kind: TaxKind) {
    return this.kinds.find((k) => k.value === kind)?.label ?? kind;
  }
  schemaUrl() {
    return `/api/tax/schema?demo=${this.demo ? "1" : "0"}`;
  }
}
