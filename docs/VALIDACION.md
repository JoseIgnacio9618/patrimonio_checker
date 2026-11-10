# Validación

Verificación local del 10 de noviembre de 2026: **68 pruebas de dominio/API/conexión/fiscalidad y 16 de Angular superadas**, build de producción y smoke HTTP/CLI correctos, `npm audit` sin vulnerabilidades conocidas. Ninguna prueba necesita credenciales del broker.

Comprobaciones preparadas para ejecutar localmente y en GitHub Actions:

| Área | Qué se comprueba |
| --- | --- |
| CSV | BOM, separadores, comillas, coma decimal, millares, columnas reasignadas, fechas imposibles, tipos desconocidos, divisas, cantidades, errores por fila e IDs conflictivos. |
| Deduplicación | Históricos solapados con IDs, multiplicidad de filas idénticas sin ID y reimportación del mismo archivo. |
| Finanzas | Efectivo y costes, FIFO proporcional, cripto fraccional, traspasos sin coste original, precios ausentes/obsoletos, ventas sin inventario, drawdown ajustado por flujos, XIRR conocido y flujos ambiguos, tarjeta, ingresos, riesgo y proyecciones. |
| API y datos | Importación sin persistir la vista previa, commit atómico, repetición sin duplicados, valoración, filtros, precios, exportación/restauración y reapertura de SQLite. |
| Aislamiento local | Host y Origin ajenos, peticiones cross-site, cabecera de mutación y demo separada de los datos reales. |
| Sesión | AES-GCM, clave incorrecta, alteración del mensaje, rotación, eliminación local y ausencia de sesión en respuestas y backups. |
| Conector | Cliente de solo lectura simulado: cuentas, posiciones, cripto, bonos por nominal, cotizaciones, detalles anidados, conciliación CSV/API en ambos órdenes, errores sin secretos, eventos modificados y exclusión entre dos procesos SQLite. |
| Fiscalidad | Escalas progresivas, cuota estatal/autonómica, FIFO fiscal, retenciones, compensación cruzada y saldos antiguos, mínimos, pérdidas por recompra, traspasos sin datos, deuda, normativa anual sin fallback, revisión y activación por huella, validación del JSON, demo y copia/restauración de perfiles. |
| Tema | Preferencia persistente, cambios del sistema, selección manual, sincronización entre pestañas y almacenamiento no disponible. |
| Angular | Estado vacío, navegación a importación, aislamiento de demo, invalidación de vista previa, métricas desconocidas y rechazo de importaciones. DOM simulado. |
| Producción | Build Angular y TypeScript, arranque real del servidor, API local, página HTML, bundle JavaScript, demo y plantilla CSV. |

## Límites de la validación

- No se ha recibido un CSV real de Trade Republic: se han usado fixtures sintéticos y una plantilla documentada. El mapeo de columnas no sustituye la comprobación de sus convenciones económicas.
- No se han usado credenciales reales ni operaciones bancarias. La conexión no oficial necesita validación en vivo por el propietario.
- Los ticks actuales se consultan automáticamente mediante el SDK; sus tests son simulados. Los cierres históricos ajustados y benchmarks siguen entrando por CSV.
- Se han capturado vistas en Chromium real: escritorio a 1440 px, modo claro y oscuro, flujo fiscal con normativa sintética de prueba y móvil a 390 px. Se han comprobado seis secciones a 390 y 360 px. La sesión de captura no registró errores de consola ni excepciones y se comprobó la ausencia de desbordamiento horizontal en la vista móvil. No equivale a una auditoría completa de accesibilidad o de todos los navegadores.
- La captura detectó que el script inline de carga de CSS crítico generado por Angular era bloqueado por CSP. Se desactivó `inlineCritical` manteniendo la política de scripts y se añadieron comprobaciones del HTML de producción para evitar esa regresión.
- El flujo fiscal del navegador usa una cartera ficticia y un perfil de prueba revisado solo para esa demostración; no se ha calculado ni certificado la declaración del propietario. Validar la estructura y los dominios de las fuentes no verifica la interpretación legal de una IA. No se certifican datos corporativos o series ajustadas que no estén en las entradas.

Los comandos reproducibles están en el README y el workflow `.github/workflows/ci.yml`.
