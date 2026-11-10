# patrimonio.

Aplicación privada de patrimonio personal, con Angular, Apache ECharts, Node.js / Express y SQLite. Importa movimientos, reconstruye posiciones y muestra el efecto del ahorro y las inversiones por separado. Interfaz en español y moneda base EUR.

## Ejecutar en tu ordenador

Necesitas **Node.js 24** (24.13 o posterior, dentro de la rama 24) y npm. Funciona sin crear cuentas, configurar un servidor de base de datos ni conectar Trade Republic.

```sh
git clone https://github.com/JoseIgnacio9618/patrimonio_checker.git
cd patrimonio_checker
npm ci
npm run build
npm start
```

Abre **http://127.0.0.1:3000**. El repositorio de código es público; los datos financieros se guardan únicamente en tu instalación local y están excluidos de Git. Ejecuta los comandos desde la raíz del proyecto.

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
- Actualización desde Trade Republic mediante botón o job periódico, con posiciones por cuenta, precios, movimientos normalizados, conciliación con CSV, ejecuciones y fotografías de la cartera.

## Primeros pasos con tus datos

1. Exporta el historial completo disponible en Trade Republic. Revisa en la aplicación sus opciones de extractos / exportación de transacciones; sus menús y formatos pueden cambiar.
2. Abre **Importaciones** y selecciona el CSV. Revisa la asignación de columnas y el formato decimal.
3. **Comprueba la convención de importes antes de confirmar**: este importador usa importe **bruto**, y resta comisiones e impuestos por separado. Si tu exportación contiene importes netos, conviértelos antes o usa costes cero si no puedes desglosarlos sin duplicarlos.
4. Revisa la muestra de movimientos y corrige todos los errores. La importación de movimientos es atómica: no guarda una parte si existen filas inválidas.
5. Importa cotizaciones de cierre en EUR para valorar los activos. Necesitas un histórico de precios para las métricas históricas, además de precios recientes para la valoración actual.
6. Reimporta los históricos actualizados cuando quieras. Un ID repetido idéntico se omite; si sus datos cambian, se muestra un conflicto.

**No se ha probado con tu CSV real.** El importador tiene alias de cabeceras españoles, ingleses y algunos alemanes, y permite reasignarlas. No afirma compatibilidad universal con todas las variantes del exportador de Trade Republic. Los tipos desconocidos no se descartan silenciosamente. No importa PDF.

CSV y API se concilian por ID o alias persistente. Con IDs diferentes se busca una coincidencia económica única entre fuentes: fecha, tipo, activo, unidades, bruto, comisión, impuesto y divisa. Dos coincidencias idénticas generan un conflicto para revisar; no se adivina cuál es correcta. Un CSV también puede completar el coste original y el valor de entrada de un traspaso previamente recogido por API.

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
| `category` | `ETF`, `STOCK`, `CRYPTO`, `GOLD`, `FUND`, `BOND`, `DERIVATIVE`, `PRIVATE` u `OTHER`. |
| `quantity` | Unidades positivas en compras, ventas y traspasos; cero en otros movimientos. |
| `amount` | Importe bruto. Su valor absoluto se interpreta según el tipo. En traspasos, valor total de mercado al entrar o salir. |
| `fee`, `tax` | Costes positivos de ese movimiento, nunca negativos. |
| `currency` | `EUR`. Sin columna se asume EUR y se avisa. |
| `costBasis` | Coste original **total** de un traspaso de entrada, no precio unitario. Vacío si se desconoce. |
| `note` | Nota opcional. |

Tipos: `DEPOSIT`, `WITHDRAWAL`, `BUY`, `SELL`, `DIVIDEND`, `INTEREST`, `CARD_PAYMENT`, `CARD_REFUND`, `SAVEBACK`, `FEE`, `TAX`, `TAX_REFUND`, `TRANSFER_IN`, `TRANSFER_OUT`. Los movimientos genéricos de transferencia deben clasificarse: dinero propio (`DEPOSIT` / `WITHDRAWAL`) y traspasos de valores (`TRANSFER_IN` / `TRANSFER_OUT`) tienen efectos diferentes.

Separadores admitidos: coma, punto y coma o tabulador; codificación UTF-8. Máximo 12 MB / 50.000 filas por importación. Para números internacionales como `1,234.56`, elige explícitamente el formato internacional. El modo automático interpreta una coma como separador decimal. Sin coma, un punto es decimal.

Solo EUR: convierte otras divisas con tipos documentados antes de importar. No hay conversión FX automática ni tratamiento especializado de splits, fusiones, opciones o ventas en corto. Las posiciones actuales se consultan por cuenta; el historial contable y FIFO se agregan por activo en una sola cartera. Ordena correctamente las operaciones de un mismo día: FIFO mantiene el orden de llegada para empates. Una salida anterior a la compra correspondiente se señala como historial incompleto.

### Bitcoin transferido desde Binance

Para `TRANSFER_IN`, `quantity` indica los BTC recibidos; `amount`, su valor de mercado en EUR ese día; y `costBasis`, el coste original total en Binance. Si `amount` es cero, se intenta usar una cotización importada de esa fecha o de los últimos 7 días. Si no existe, se ocultan las aportaciones y rentabilidades afectadas.

Si falta `costBasis`, la app no inventa un coste cero. La ganancia FIFO y el resultado latente afectados aparecen como desconocidos. El rendimiento económico desde que entraron en esta cartera puede calcularse si se conoce su valor de entrada, aunque su ganancia desde la adquisición original siga sin conocerse.

## Cotizaciones y comparativas

[public/plantilla-precios.csv](public/plantilla-precios.csv): `asset,date,price`, opcionalmente `currency` que debe ser EUR. `price` es el cierre por unidad en euros, estrictamente positivo. Importar de nuevo una fecha/activo actualiza su precio.

La cartera comunicada recibe cotizaciones actuales del SDK en cada recogida. Los cierres históricos y benchmarks se proporcionan mediante CSV: **el SDK no se usa como proveedor de series históricas ajustadas**. Sus ticks actuales se guardan con hora en la fotografía del broker; no se escriben como cierres diarios, para evitar fabricar un histórico. No se confunde el precio de compra con el valor actual. Una cotización ausente o con más de 7 días de antigüedad deja la valoración afectada sin calcular. Para días sin sesión se arrastra el último cierre hasta ese límite, y se indica la fecha del precio.

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

## Actualización con Trade Republic y jobs

Usa [`trade-republic-sdk` 0.5.0](https://github.com/Nils-Fischer/trade-republic-sdk), una librería **no oficial**, mediante operaciones de lectura: `cash`, `accountPairs`, `compactPortfolioByType`, `ticker`, historial paginado y `timelineDetailV2`. No se exponen órdenes, pagos ni transferencias.

### Conectar una vez

```sh
npm run tr:connect
```

Introduce teléfono y PIN **solo en tu terminal** y aprueba la petición en el móvil. El PIN no se guarda. La sesión se cifra con AES-256-GCM y la clave `data/session.key` tiene permisos `0600`. Si el broker exige autenticación de nuevo, repite el comando. No envíes el PIN ni sesiones por chat.

### Botón o CSV

- **Importaciones:** puedes seguir subiendo CSV con vista previa y confirmación.
- **Conexiones → Actualizar ahora:** inicia una ejecución en segundo plano. La interfaz muestra el resultado y actualiza la cartera y los movimientos.
- **Revisar histórico completo:** vuelve a consultar el historial desde 2000; las consultas incrementales releen 7 días y reintentan eventos pendientes anteriores.
- **Mi cartera:** alterna entre posiciones comunicadas por el broker y posiciones reconstruidas del historial. La vista general muestra patrimonio comunicado, precios con fecha y las últimas 1.000 fotografías guardadas.

La recogida consulta todas las cuentas de valores devueltas por el SDK, conserva las categorías recibidas y obtiene precios por instrumento. Acciones, ETF, cripto, bonos, fondos, derivados y mercados privados pueden aparecer como posiciones; que aparezcan no implica que haya precio disponible o que sus operaciones tengan un tratamiento fiscal especializado. Los productos adicionales que no tienen una posición interpretable se cuentan y se señalan como pendientes, sin inventar su valoración.

Por defecto se consulta `ISIN.LSX` para valores y `ISIN.BHS` para cripto, en la divisa de la cuenta (EUR si no se comunica). En **Mercados por activo** puedes configurar ticker, divisa y divisor. Los bonos usan divisor 100 para convertir una cotización porcentual en precio por nominal. Una cotización ausente, obsoleta o en otra divisa deja su valor en EUR sin calcular. La suma conocida se muestra por separado cuando no hay un patrimonio total completo.

### Movimientos y conciliación

Los movimientos ejecutados reconocidos se normalizan automáticamente: compras/ventas ordinarias y planes, ingresos/retiradas, tarjeta, intereses, dividendos, impuestos/devoluciones y traspasos identificables. Se recuperan detalles anidados para unidades, comisiones y retenciones. El bruto se reconstruye a partir del neto y costes; los separadores ambiguos se contrastan con cantidad y precio cuando es posible.

Los eventos desconocidos, Saveback reinvertido sin desglose suficiente, operaciones corporativas, cantidades ambiguas o detalles ausentes quedan pendientes. Pendientes y cancelados no se contabilizan como ejecutados. Si cambia un evento ya registrado se crea un conflicto y se conserva la operación existente. Se comparan efectivo y unidades reconstruidos con la fotografía del broker para señalar huecos del historial. No se usa el precio medio comunicado para inventar lotes FIFO.

### Crear un job desde la app

En **Conexiones**, activa **Job periódico**, indica el intervalo en minutos (de 5 a 10.080; por defecto 360) y pulsa **Guardar job**. Con el servidor activo, se comprueba cada minuto y se ejecuta también al arrancar si corresponde. **La pestaña puede estar cerrada.** La frecuencia y el historial de ejecuciones se conservan en SQLite. La interfaz muestra la próxima ejecución y las 30 últimas, con estado, posiciones, precios, movimientos y pendientes.

Una concesión de exclusión en SQLite impide ejecuciones solapadas entre el botón, el servidor y procesos externos. Los fallos respetan el intervalo de reintento, conservan la última fotografía correcta y ocultan los detalles técnicos que pudieran contener credenciales. La recogida tiene un límite global de 4 minutos y la concesión caduca a los 5 minutos si el proceso termina inesperadamente.

### Ejecutarlo con el servidor web apagado

```sh
npm run tr:sync                  # Recogida manual desde terminal
npm run tr:sync -- --full        # Recorrido completo
npm run tr:sync -- --scheduled   # Solo ejecuta si el job está activado y corresponde
```

Para usar cron, systemd o el Programador de tareas de Windows, programa el tercer comando cada minuto o cada 5 minutos. Establece como directorio de trabajo la raíz del proyecto, usa la misma cuenta del sistema que hizo el login y mantén la misma `PATRIMONIO_DATA_DIR`. El propio comando comprueba la frecuencia guardada: no hace falta instalar una segunda planificación independiente con la duración exacta. Consulta [docs/JOBS.md](docs/JOBS.md) para ejemplos.

**Validación:** las pruebas usan un cliente simulado con las formas de respuesta del SDK instalado. No se ha iniciado sesión en tu cuenta ni confirmado en vivo la cobertura de todos tus productos o del CSV real. La API privada puede cambiar y algunos activos pueden necesitar otra regla de mercado. No hay sincronización Binance: su coste original debe aportarse aparte.

## Datos, copias y seguridad local

- Base de datos: `data/patrimonio.db`. Directorio `0700`, base de datos y clave `0600` en sistemas POSIX. Puedes cambiar la ruta con `PATRIMONIO_DATA_DIR` manteniéndola fuera del repositorio.
- La app escucha solo en `127.0.0.1`; valida Host y Origin y exige una cabecera propia para mutaciones. No hay CORS abierto. Las respuestas API no se almacenan en caché.
- No hay telemetría ni recursos externos de fuentes, imágenes o precios. Solo se contacta con Trade Republic cuando ejecutas el login o la sincronización del conector.
- SQLite y la copia JSON **no están cifrados**. La clave local y la sesión cifrada juntas permiten recuperar la sesión. Protege el ordenador y las copias, por ejemplo con cifrado de disco.
- No expongas el servidor a Internet. No incorpora autenticación multiusuario; otro proceso de tu usuario local puede acceder. Para hosting harían falta autenticación, aislamiento y otro modelo de secretos y almacenamiento.
- `.gitignore` excluye datos, claves, `.env`, dependencias y builds. Ningún dato bancario real está incluido.

**Mis datos → Descargar copia completa** exporta un JSON de versión 2 con movimientos, precios, fotografías del broker y alias/origen de conciliación; no incluye sesión, clave, configuración del job, actividad del conector ni historial de importaciones/ejecuciones. Se aceptan también copias de versión 1. Restaura en una base vacía, con validación atómica. Para un respaldo de toda la instalación, detén el servidor antes de copiar la carpeta `data/` y guarda esa copia de forma privada. El CSV exportado está protegido frente a fórmulas de hojas de cálculo; usa JSON para restaurar IDs y orden exactamente.

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

Puedes ver [capturas reales de la aplicación](docs/capturas/README.md), con datos ficticios de demostración.

Consulta [docs/VALIDACION.md](docs/VALIDACION.md) para el alcance verificado y [docs/ROADMAP.md](docs/ROADMAP.md) para las extensiones previstas.
