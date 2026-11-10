# patrimonio.

Aplicación privada de patrimonio personal, con Angular, Apache ECharts, Node.js / Express y SQLite. Importa movimientos, reconstruye posiciones y muestra el efecto del ahorro y las inversiones por separado. Interfaz en español y moneda base EUR.

## Ejecutar en tu ordenador

Necesitas **Node.js 24** (24.13 o posterior, dentro de la rama 24) y npm. Funciona sin crear cuentas, configurar un servidor de base de datos ni conectar Trade Republic.

```sh
git clone https://github.com/JoseIgnacio9618/patrimonio.git
cd patrimonio
npm ci
npm run build
npm start
```

Abre **http://127.0.0.1:3000**. El repositorio es privado: clónalo con tu cuenta de GitHub autenticada. Ejecuta los comandos desde la raíz del proyecto.

Para desarrollar con recarga automática:

```sh
npm run dev
```

Abre http://127.0.0.1:4200. El frontend redirige `/api` al backend local en el puerto 3000. No ejecutes `npm start` y `npm run dev` simultáneamente.

**Explorar demo** carga una cartera ficticia en memoria, separada de SQLite. No hay movimientos precargados en tu cartera real ni importaciones sobre la demo.

## Qué incluye

- Vista general con evolución diaria, patrimonio, aportaciones netas y resultado.
- Posiciones, coste FIFO, beneficio realizado y latente, pesos y efectivo reconstruido.
- Movimientos con búsqueda, filtros de tipo y fecha, y paginación.
- Dividendos, intereses, Saveback, comisiones, impuestos y gasto con tarjeta.
- TWR diario aproximado, XIRR, volatilidad, drawdown, Sharpe y concentración HHI.
- Benchmarks importables: S&P 500, MSCI World, oro, Bitcoin u otros.
- Proyecciones a 5, 10, 15 y 20 años, con inflación y supuestos ajustables.
- Importación con vista previa, asignación de columnas, errores por fila, IDs y deduplicación.
- Importación de precios, exportación de movimientos y copia/restauración JSON.
- Conector experimental de Trade Republic con sesión cifrada, programación y bandeja de actividad.

## Primeros pasos con tus datos

1. Exporta el historial completo disponible en Trade Republic. Revisa en la aplicación sus opciones de extractos / exportación de transacciones; sus menús y formatos pueden cambiar.
2. Abre **Importaciones** y selecciona el CSV. Revisa la asignación de columnas y el formato decimal.
3. **Comprueba la convención de importes antes de confirmar**: este importador usa importe **bruto**, y resta comisiones e impuestos por separado. Si tu exportación contiene importes netos, conviértelos antes o usa costes cero si no puedes desglosarlos sin duplicarlos.
4. Revisa la muestra de movimientos y corrige todos los errores. La importación de movimientos es atómica: no guarda una parte si existen filas inválidas.
5. Importa cotizaciones de cierre en EUR para valorar los activos. Necesitas un histórico de precios para las métricas históricas, además de precios recientes para la valoración actual.
6. Reimporta los históricos actualizados cuando quieras. Un ID repetido idéntico se omite; si sus datos cambian, se muestra un conflicto.

**No se ha probado con tu CSV real.** El importador tiene alias de cabeceras españoles, ingleses y algunos alemanes, y permite reasignarlas. No afirma compatibilidad universal con todas las variantes del exportador de Trade Republic. Los tipos desconocidos no se descartan silenciosamente. No importa PDF.

Sin ID se usa una huella de los datos normalizados y su número de repetición. Así se conservan dos operaciones idénticas dentro del mismo archivo y se omiten al reimportar ese mismo histórico. Dos operaciones idénticas en archivos parciales distintos son indistinguibles: conserva IDs o importa históricos completos. No se concilian automáticamente IDs diferentes de brokers diferentes.

### Formato de movimientos

Consulta [public/plantilla-movimientos.csv](public/plantilla-movimientos.csv). **Todas las filas de la plantilla son ficticias: sustitúyelas.**

| Campo | Convención |
| --- | --- |
| `id` | ID estable del movimiento, recomendado. |
| `date` | `AAAA-MM-DD` o `DD/MM/AAAA`. Se usa la fecha contable del archivo; las horas no determinan el orden. |
| `type` | Tipo normalizado de la lista siguiente. |
| `asset` | ISIN o símbolo estable, requerido si se mueven unidades. |
| `name` | Nombre legible. |
| `category` | `ETF`, `STOCK`, `CRYPTO`, `GOLD`, `FUND` u `OTHER`. |
| `quantity` | Unidades positivas en compras, ventas y traspasos; cero en otros movimientos. |
| `amount` | Importe bruto. Su valor absoluto se interpreta según el tipo. En traspasos, valor total de mercado al entrar o salir. |
| `fee`, `tax` | Costes positivos de ese movimiento, nunca negativos. |
| `currency` | `EUR`. Sin columna se asume EUR y se avisa. |
| `costBasis` | Coste original **total** de un traspaso de entrada, no precio unitario. Vacío si se desconoce. |
| `note` | Nota opcional. |

Tipos: `DEPOSIT`, `WITHDRAWAL`, `BUY`, `SELL`, `DIVIDEND`, `INTEREST`, `CARD_PAYMENT`, `CARD_REFUND`, `SAVEBACK`, `FEE`, `TAX`, `TRANSFER_IN`, `TRANSFER_OUT`. Los movimientos genéricos de transferencia deben clasificarse: dinero propio (`DEPOSIT` / `WITHDRAWAL`) y traspasos de valores (`TRANSFER_IN` / `TRANSFER_OUT`) tienen efectos diferentes.

Separadores admitidos: coma, punto y coma o tabulador; codificación UTF-8. Máximo 12 MB / 50.000 filas por importación. Para números internacionales como `1,234.56`, elige explícitamente el formato internacional. El modo automático interpreta una coma como separador decimal. Sin coma, un punto es decimal.

Solo EUR: convierte otras divisas con tipos documentados antes de importar. No hay conversión FX automática ni soporte de splits, fusiones, opciones, ventas en corto o cuentas múltiples. Ordena correctamente las operaciones de un mismo día: FIFO mantiene el orden de llegada para empates. Una salida anterior a la compra correspondiente se señala como historial incompleto.

### Bitcoin transferido desde Binance

Para `TRANSFER_IN`, `quantity` indica los BTC recibidos; `amount`, su valor de mercado en EUR ese día; y `costBasis`, el coste original total en Binance. Si `amount` es cero, se intenta usar una cotización importada de esa fecha o de los últimos 7 días. Si no existe, se ocultan las aportaciones y rentabilidades afectadas.

Si falta `costBasis`, la app no inventa un coste cero. La ganancia FIFO y el resultado latente afectados aparecen como desconocidos. El rendimiento económico desde que entraron en esta cartera puede calcularse si se conoce su valor de entrada, aunque su ganancia desde la adquisición original siga sin conocerse.

## Cotizaciones y comparativas

[public/plantilla-precios.csv](public/plantilla-precios.csv): `asset,date,price`, opcionalmente `currency` que debe ser EUR. `price` es el cierre por unidad en euros, estrictamente positivo. Importar de nuevo una fecha/activo actualiza su precio.

Los precios se proporcionan mediante CSV: **no hay un proveedor automático de cotizaciones activado**. No se confunde el precio de compra con el valor actual. Una cotización ausente o con más de 7 días de antigüedad deja la valoración afectada sin calcular. Para días sin sesión se arrastra el último cierre hasta ese límite, y se indica la fecha del precio.

Los símbolos con prefijo `BENCH:`, por ejemplo `BENCH:SP500`, `BENCH:MSCI_WORLD`, `BENCH:GOLD` o `BENCH:BTC`, alimentan comparativas normalizadas a 100. No forman parte de tus posiciones. Usa datos consistentes en EUR, preferiblemente índices de retorno total para comparar carteras que cobran dividendos. Cada serie se normaliza en su primer dato disponible dentro del periodo; si falta el inicio, los horizontes pueden diferir.

## Cómo se calculan las estadísticas

- Efectivo: depósitos y cobros menos compras, retiradas, pagos y costes. No se sustituye por el saldo del conector.
- Aportaciones netas: depósitos menos retiradas y gasto neto con tarjeta, más valor de mercado neto de traspasos de activos. Un reembolso de tarjeta revierte el gasto; intereses, dividendos y Saveback son rendimiento.
- Resultado: patrimonio valorado menos aportaciones netas. Incluye ingresos y costes del periodo. No presupone que las retiradas sean una pérdida de inversión.
- FIFO: consume los lotes antiguos y prorratea su coste, con `decimal.js` de 40 dígitos de precisión. Los datos se guardan como cadenas decimales y las cifras monetarias se redondean a dos decimales al presentar. Las ventas netean sus comisiones e impuestos registrados; no se calculan nuevos impuestos ni reglas fiscales por país.
- TWR **aproximado**: encadena `(valor final − flujo externo) / valor anterior − 1`; la primera financiación se considera al inicio del día. No reconstruye cotizaciones o flujos intradía. Falta de precios o historial inválido oculta esta métrica.
- XIRR: usa importes y fechas de los flujos externos y el patrimonio final, con año de 365 días. Se exige un único cambio de signo de forma conservadora; no se elige arbitrariamente una de varias raíces. Sin horizonte temporal, raíz admisible o valoración final no se muestra.
- Riesgo: volatilidad y Sharpe requieren al menos 30 rendimientos diarios. Usan desviación muestral y factor `√365`, días naturales, y tipo libre de riesgo cero. Los precios arrastrados pueden suavizar la volatilidad. Drawdown se calcula sobre TWR, evitando que las aportaciones oculten caídas. HHI incluye efectivo.
- Las proyecciones usan capitalización mensual, aportaciones a fin de mes e inflación constante; no incluyen fiscalidad ni comisiones futuras.

No es un programa de presentación de impuestos. Los lotes transferidos fuera, por ejemplo, no generan una venta en esta cartera; para conocer el resultado fiscal global necesitas el historial completo de todas tus cuentas.

## Conexión experimental a Trade Republic

Usa [`trade-republic-sdk` 0.5.0](https://github.com/Nils-Fischer/trade-republic-sdk), una librería **no oficial**. El adaptador de esta app solo llama a autenticación/refresco, lectura de efectivo y lectura de timeline. No expone órdenes, pagos ni transferencias.

```sh
npm run tr:connect
```

Introduce teléfono y PIN **solo en tu terminal** y aprueba la petición en tu móvil. El PIN no se muestra ni se guarda. No pases credenciales por chat, argumentos o archivos del repositorio. La sesión se cifra con AES-256-GCM; `data/session.key` tiene permisos `0600`. La sesión cifrada se almacena en SQLite y nunca forma parte de una copia exportada.

En **Conexiones**, activa la frecuencia (por defecto cada 6 horas), o sincroniza manualmente. El servidor debe estar ejecutándose. El planificador comprueba cada minuto; evita ejecuciones solapadas y repeticiones dentro del intervalo incluso tras fallos. La primera lectura pide el histórico desde 2000; las siguientes releen 7 días para recoger cambios recientes. Puede requerir reautenticación.

**Alcance real:** guarda el saldo comunicado y los eventos en una bandeja de revisión persistente y deduplicada. El timeline puede carecer de unidades, ISIN, costes o estado definitivo, por lo que **no se convierte automáticamente en contabilidad** ni se mezcla con los CSV. Las operaciones contables siguen entrando por CSV validado. Se muestran los últimos 500 eventos, conservando el resto en SQLite.

El conector tiene pruebas con cliente simulado, cifrado, fallos y planificación. **No se ha conectado a tu cuenta ni validado en vivo.** Una importación automática completa de todas las operaciones requerirá verificar los detalles/documentos del broker con una sesión real y reconciliarlos con el CSV. No hay sincronización Binance implementada; la separación entre adaptadores permite incorporarla después.

## Datos, copias y seguridad local

- Base de datos: `data/patrimonio.db`. Directorio `0700`, base de datos y clave `0600` en sistemas POSIX. Puedes cambiar la ruta con `PATRIMONIO_DATA_DIR` manteniéndola fuera del repositorio.
- La app escucha solo en `127.0.0.1`; valida Host y Origin y exige una cabecera propia para mutaciones. No hay CORS abierto. Las respuestas API no se almacenan en caché.
- No hay telemetría ni recursos externos de fuentes, imágenes o precios. Solo se contacta con Trade Republic cuando ejecutas el login o la sincronización del conector.
- SQLite y la copia JSON **no están cifrados**. La clave local y la sesión cifrada juntas permiten recuperar la sesión. Protege el ordenador y las copias, por ejemplo con cifrado de disco.
- No expongas el servidor a Internet. No incorpora autenticación multiusuario; otro proceso de tu usuario local puede acceder. Para hosting harían falta autenticación, aislamiento y otro modelo de secretos y almacenamiento.
- `.gitignore` excluye datos, claves, `.env`, dependencias y builds. Ningún dato bancario real está incluido.

**Mis datos → Descargar copia completa** exporta un JSON de versión 1 con movimientos y precios; no incluye sesión, clave, actividad del conector ni historial de importaciones. Restaura en una base vacía, con validación atómica. Para un respaldo de toda la instalación, detén el servidor antes de copiar la carpeta `data/` y guarda esa copia de forma privada. El CSV exportado está protegido frente a fórmulas de hojas de cálculo; usa JSON para restaurar IDs y orden exactamente.

## Pruebas y estructura

```sh
npm test                 # Motor financiero, CSV, API/SQLite, cifrado y conector simulado
npm run test:web         # Componentes Angular con Vitest y DOM simulado
npm run build            # Build de producción Angular + TypeScript del backend
npm run test:production  # Arranque real del build, API, página y assets HTTP
npm audit
```

GitHub Actions repite las verificaciones en Node 24. Las pruebas Angular usan DOM simulado, **no un navegador real**; no certifican el aspecto visual ni el comportamiento en todas las pantallas. La integración real con un CSV y sesión de tu cuenta queda por validar.

```text
web/       Componentes Angular, navegación, formularios y gráficos ECharts
server/    API Express, SQLite, importador, cálculo financiero y conector
shared/    Tipos compartidos
tests/     Pruebas de dominio, API, persistencia, seguridad y smoke de producción
public/    Plantillas CSV y favicon
docs/      Validación y próximos pasos
```

Consulta [docs/VALIDACION.md](docs/VALIDACION.md) para el alcance verificado y [docs/ROADMAP.md](docs/ROADMAP.md) para las extensiones previstas.
