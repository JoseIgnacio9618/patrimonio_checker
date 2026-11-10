import { z } from "zod";
import { createHash } from "node:crypto";
import type { AnnualTaxRules } from "../shared/tax.js";
const official = (url: string) => {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      [
        "boe.es",
        "www.boe.es",
        "sede.agenciatributaria.gob.es",
        "www3.agenciatributaria.gob.es",
        "petete.tributos.hacienda.gob.es",
      ].includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.port
    );
  } catch {
    return false;
  }
};
const brackets = z
  .array(
    z
      .object({
        upTo: z.number().finite().positive().nullable(),
        rate: z.number().finite().min(0).max(1),
      })
      .strict(),
  )
  .min(1)
  .max(20)
  .superRefine((rows, ctx) => {
    let last = 0,
      rate = 0;
    for (const [i, row] of rows.entries()) {
      if (
        row.upTo === null
          ? i !== rows.length - 1
          : row.upTo <= last || i === rows.length - 1
      )
        ctx.addIssue({
          code: "custom",
          message: "Tramos crecientes; solo el último debe terminar en null",
        });
      if (row.rate < rate)
        ctx.addIssue({
          code: "custom",
          message: "Los tipos deben ser progresivos",
        });
      last = row.upTo ?? last;
      rate = row.rate;
    }
  });
export const annualRulesSchema = z
  .object({
    format: z.literal("patrimonio-irpf"),
    version: z.literal(1),
    model: z.literal("es-common-savings-fifo-v1"),
    year: z.number().int().min(2010).max(2100),
    jurisdiction: z.literal("ES_COMMON"),
    verifiedAt: z.iso.date(),
    stateBrackets: brackets,
    regionalBrackets: brackets,
    crossOffsetLimit: z.number().finite().min(0).max(1),
    carryYears: z.number().int().min(0).max(10),
    repurchaseMonths: z
      .object({
        listed: z.number().int().min(0).max(24),
        unlisted: z.number().int().min(0).max(24),
        debt: z.number().int().min(0).max(24),
        other: z.number().int().min(0).max(24),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            title: z.string().min(1).max(200),
            url: z
              .string()
              .url()
              .max(1500)
              .refine(
                official,
                "Se requiere una URL HTTPS de una fuente oficial admitida",
              ),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    notes: z.array(z.string().max(1500)).max(30),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.verifiedAt > new Date().toISOString().slice(0, 10))
      ctx.addIssue({
        code: "custom",
        message: "La fecha de verificación no puede ser futura",
      });
  });
export const rulesFingerprint = (rules: AnnualTaxRules) =>
  createHash("sha256").update(JSON.stringify(rules)).digest("hex");
export function taxPrompt(year: number): string {
  return `Investiga la normativa del IRPF español del EJERCICIO ${year} (ventas y rentas obtenidas en ${year}, declaración presentada normalmente en ${year + 1}), para residentes en ESPAÑA, TERRITORIO COMÚN. Necesito un fichero JSON para una calculadora local de la base del ahorro. No necesito asesoramiento de compra/venta ni que calcules mis datos personales. No te he facilitado importes de mi cartera.

Consulta únicamente fuentes oficiales: BOE y AEAT. Comprueba que cada redacción y tipo sea aplicable al ejercicio ${year}; distingue cuota estatal y autonómica. No copies automáticamente los tipos actuales a un año diferente. Verifica integración/compensación del ahorro, plazo de arrastre, límites cruzados y reglas de recompra por categoría. Las pérdidas cripto se revisan por separado en la aplicación; no las conviertas automáticamente en valores homogéneos.

El modelo es es-common-savings-fifo-v1: ventas ordinarias en EUR con FIFO; bonos en rendimientos del capital mobiliario; mínimos remanentes estatal y autonómico separados; compensación cruzada con un único porcentaje y arrastre por antigüedad. No modela regímenes forales, no residentes, reglas transitorias de adquisiciones anteriores a 1995, derivados complejos, exenciones de traspasos de fondos, doble imposición ni cambios de norma que requieran algoritmos diferentes. Si para ${year} este modelo no sirve, NO inventes un fichero compatible: explica qué falta para que se revise el motor. Si el ejercicio aún no tiene normativa publicada, indícalo y no lo completes con pronósticos.

Devuelve un fichero descargable llamado normativa-irpf-${year}.json, JSON UTF-8 sin comentarios ni bloques Markdown, con EXACTAMENTE estos campos:
{
 "format":"patrimonio-irpf", "version":1, "model":"es-common-savings-fifo-v1",
 "year":${year}, "jurisdiction":"ES_COMMON", "verifiedAt":"AAAA-MM-DD",
 "stateBrackets":[{"upTo":6000,"rate":0.095},{"upTo":null,"rate":0.105}],
 "regionalBrackets":[{"upTo":6000,"rate":0.095},{"upTo":null,"rate":0.105}],
 "crossOffsetLimit":0.25, "carryYears":4,
 "repurchaseMonths":{"listed":2,"unlisted":12,"debt":2,"other":12},
 "sources":[{"title":"Título, artículo y fecha aplicable","url":"https://www.boe.es/..."}],
 "notes":["Supuestos, diferencias anuales y límites relevantes"]
}
IMPORTANTE: todos los NÚMEROS del ejemplo son solo una ilustración del formato: investiga y reemplázalos por los aplicables a ${year}. upTo es el límite SUPERIOR ACUMULADO en euros, nunca la anchura del tramo. Solo el último upTo es null (sin límite). rate usa fracción decimal: 9,5 % = 0.095, no 9.5. Incluye TODOS los tramos estatales y autonómicos. Las fuentes deben ser URLs concretas oficiales de boe.es, www.boe.es, sede.agenciatributaria.gob.es, www3.agenciatributaria.gob.es o petete.tributos.hacienda.gob.es. Indica en notes qué documentos o artículos sustentan cada regla, su vigencia y cualquier incertidumbre. verifiedAt es el día real en que lo compruebes, sin fechas futuras. La aplicación me mostrará el contenido para que lo revise antes de activarlo. No declares que el fichero está validado o certificado por la AEAT.`;
}
