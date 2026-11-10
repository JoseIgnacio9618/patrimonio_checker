# Fiscalidad por ejercicio

En **Fiscalidad** se elige explícitamente el año de obtención de las rentas. Por ejemplo, las ventas de 2026 corresponden al ejercicio 2026 y normalmente se declaran en 2027. No se presupone tu residencia ni se aplica automáticamente la ley actual a ejercicios anteriores.

## Flujo de normativa con una IA

1. Introduce el **ejercicio fiscal** y pulsa **Abrir ejercicio**.
2. Pulsa **Copiar prompt para la IA**. También puedes abrir el texto completo y copiarlo manualmente.
3. Pásalo a una IA con acceso a fuentes oficiales. Solicita el fichero descargable `normativa-irpf-AÑO.json` que indica el prompt. No necesita tus movimientos, cartera ni datos identificativos.
4. Descarga el resultado y pulsa **Importar fichero de normativa**. La app exige JSON UTF-8, formato y modelo conocidos, año coincidente, números válidos, tramos ordenados y enlaces HTTPS de BOE/AEAT/Hacienda admitidos. Rechaza campos extra y fechas de verificación futuras.
5. Revisa la vista previa: escalas estatal y autonómica, límites, plazos, notas y fuentes. Solo después pulsa **He revisado las fuentes: activar perfil AÑO**. La importación por sí sola no activa nada.
6. Completa los **datos fiscales personales de ese ejercicio** y guarda. Sin normativa anual revisada, régimen compatible e historial confirmado, la cuota se deja pendiente.

Validar el JSON no comprueba la veracidad de su interpretación legal. Una IA puede equivocarse aunque enlace al BOE. Los datos se pueden revisar con un asesor; el fichero no queda certificado por Hacienda. El prompt pide que la IA explique la incompatibilidad si el modelo no cubre las reglas de ese año, en vez de fabricar una respuesta compatible.

El esquema descargable describe los campos. El backend añade controles de coherencia que JSON Schema no expresa por sí solo. Cada perfil declara `format: patrimonio-irpf`, `version: 1`, `model: es-common-savings-fifo-v1`, el ejercicio, jurisdicción `ES_COMMON`, fecha de verificación, escalas, compensación, arrastre, recompra, fuentes y notas. Los tipos se expresan como fracciones (`0.095` = 9,5 %). `upTo` es el **límite superior acumulado**, y solo el último tramo termina en `null`.

No hay una normativa precargada activa. Cada año necesita su propio fichero. Las revisiones se conservan por huella SHA-256; activar una nueva revisión cambia el perfil activo de ese año y no borra versiones anteriores. Los perfiles son datos declarativos: no ejecutan código ni instrucciones de la IA.

## Información que pide la aplicación

| Dato | Uso |
| --- | --- |
| Residencia y régimen del ejercicio | El motor implementa únicamente residentes en España en territorio común. Foral y no residentes quedan sin cuota. |
| Historial completo de brokers/exchanges | FIFO necesita todos los lotes del activo, con un identificador consistente. Confirma además el orden de operaciones que comparten fecha. |
| Clasificación fiscal por activo | Distingue valores cotizados, no cotizados, cripto, deuda y otros bienes. Oro, derivados y otros productos quedan pendientes por defecto. Revisa mercados y naturaleza jurídica. |
| Otros rendimientos y ganancias/pérdidas | Sitúan las operaciones en el tramo marginal del ahorro correcto. Evita duplicar rentas ya importadas. |
| Pérdidas anteriores | Año de origen, categoría y saldo pendiente; no reutilices pérdidas ya compensadas. No se arrastran automáticamente entre informes. |
| Mínimo estatal/autonómico remanente | Parte que no se ha agotado en la base general; normalmente cero si ya se aplicó allí. |
| Retenciones españolas confirmadas | Se descuentan de la cuota del ahorro. Un campo `tax` del CSV puede ser retención extranjera y no se descuenta automáticamente. |
| Saveback | Se exige revisar su calificación cuando hay importes. La app no decide automáticamente su tributación. |
| Pérdidas por recompra | Importe computable confirmado cuando hay riesgo o una situación que exige revisión. Cero significa diferir toda la pérdida. |

Los datos anteriores se guardan por año. La clasificación de activos y la comisión prevista por venta son comunes a la cartera. Los controles fiscales de la demo solo afectan a su base temporal en memoria.

## Resultados

- **Ventas realizadas:** valor neto de comisión, coste FIFO fiscal, ganancia/pérdida y resultado computable. El coste de compra incluye gastos y tributos de adquisición; una retención de IRPF en la venta no reduce su ganancia.
- **Cuota estimada del ahorro:** integra las rentas y compensaciones facilitadas, aplica las escalas del fichero anual y resta los mínimos remanentes indicados. También muestra el saldo tras retenciones españolas confirmadas y el efecto marginal de las transmisiones.
- **Si vendes hoy:** simula vender íntegramente cada posición con los tramos del **año actual**, aunque estés consultando un informe anterior. Necesita completar también el perfil del año actual. Muestra ganancia, impuesto adicional y neto previsto. En **Mi cartera** se incluye el mismo resumen por activo.
- **Liquidación conjunta:** se calcula con todas las posiciones a la vez; sumar las cuotas individuales puede dar un resultado distinto por la progresividad y las compensaciones.

Una cuota adicional negativa expresa una posible reducción de la cuota del ahorro, no una devolución garantizada. Se asume que no habrá recompras que impidan compensar las pérdidas hipotéticas. Las valoraciones necesitan precios recientes en EUR; el precio medio del broker no sustituye los lotes fiscales.

## Lotes transferidos y situaciones pendientes

Un `TRANSFER_IN` requiere `costBasis` (coste fiscal original **total**) y `acquisitionDate` (fecha de adquisición original), además del valor de entrada `amount`. Si un traspaso agrupa varias compras, usa una fila por lote original. La fecha del traspaso no sustituye a la compra original. Si falta esa fecha, puede cambiar todo el orden FIFO y quedan pendientes las ventas posteriores afectadas.

Las entradas y salidas entre tus cuentas no son ventas. Este historial representa una cartera: para evitar huecos o duplicidades al integrar brokers hay que conciliar los traspasos y conservar los lotes originales. Las adquisiciones anteriores a 1995 y las ventas sin inventario suficiente necesitan revisión y bloquean la cuota correspondiente.

Las pérdidas con recompra no se liberan automáticamente: revisa su imputación, proporción y eventual liberación con el historial global. Las pérdidas cripto requieren revisión independiente y no se tratan automáticamente como valores homogéneos cotizados. Las pérdidas patrimoniales diferidas liberadas se introducen aparte; para rendimientos de deuda ajusta sus rendimientos netos confirmados, evitando duplicar el saldo.

## Alcance

Es una **estimación de la parte del ahorro**, no el resultado completo a ingresar de tu declaración de IRPF. No presenta la renta ni calcula la base general, deducciones, doble imposición internacional, régimen foral/no residentes, reglas transitorias anteriores a 1995, derivados complejos, exenciones de traspasos de fondos, splits, fusiones ni conversión de divisas. Un fichero nuevo no añade algoritmos que el motor no implemente.

Los informes muestran sus fuentes anuales. Como referencia del diseño se revisaron la [Ley 35/2006 en BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764), artículos 33, 35, 37, 49, 66 y 76, y los manuales oficiales de AEAT sobre integración/compensación, recompra y monedas virtuales. Las escalas usadas en las pruebas de 2026 no se activan en tu cartera por defecto.

La copia JSON v3 conserva configuración fiscal, versiones y perfiles activos. Su restauración recupera esos perfiles previamente revisados; no los vuelve a certificar. Los datos fiscales personales permanecen locales y nunca se incluyen en el prompt.
