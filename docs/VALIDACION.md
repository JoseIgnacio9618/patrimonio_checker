# Validación de la primera versión

Verificación local del 10 de noviembre de 2026: **34 pruebas de dominio/API/conexión y 6 de Angular superadas**, build de producción y smoke HTTP correctos, `npm audit` sin vulnerabilidades conocidas. Ninguna prueba necesita credenciales del broker.

Comprobaciones preparadas para ejecutar localmente y en GitHub Actions:

| Área | Qué se comprueba |
| --- | --- |
| CSV | BOM, separadores, comillas, coma decimal, millares, columnas reasignadas, fechas imposibles, tipos desconocidos, divisas, cantidades, errores por fila e IDs conflictivos. |
| Deduplicación | Históricos solapados con IDs, multiplicidad de filas idénticas sin ID y reimportación del mismo archivo. |
| Finanzas | Efectivo y costes, FIFO proporcional, cripto fraccional, traspasos sin coste original, precios ausentes/obsoletos, ventas sin inventario, drawdown ajustado por flujos, XIRR conocido y flujos ambiguos, tarjeta, ingresos, riesgo y proyecciones. |
| API y datos | Importación sin persistir la vista previa, commit atómico, repetición sin duplicados, valoración, filtros, precios, exportación/restauración y reapertura de SQLite. |
| Aislamiento local | Host y Origin ajenos, peticiones cross-site, cabecera de mutación y demo separada de los datos reales. |
| Sesión | AES-GCM, clave incorrecta, alteración del mensaje, rotación, eliminación local y ausencia de sesión en respuestas y backups. |
| Conector | Cliente de solo lectura simulado, deduplicación de eventos, saldo separado, errores sin secretos, frecuencia y exclusión de ejecuciones concurrentes. |
| Angular | Estado vacío, navegación a importación, aislamiento de demo, invalidación de vista previa, métricas desconocidas y rechazo de importaciones. DOM simulado. |
| Producción | Build Angular y TypeScript, arranque real del servidor, API local, página HTML, bundle JavaScript, demo y plantilla CSV. |

## Límites de la validación

- No se ha recibido un CSV real de Trade Republic: se han usado fixtures sintéticos y una plantilla documentada. El mapeo de columnas no sustituye la comprobación de sus convenciones económicas.
- No se han usado credenciales reales ni operaciones bancarias. La conexión no oficial necesita validación en vivo por el propietario.
- La comparación de precios utiliza archivos proporcionados: no hay feed automático de mercado.
- No se ha hecho una inspección en navegador real. El entorno no ofrece una herramienta de control de navegador y el flujo de Sites utilizado no permite improvisar otra en ese caso; se han usado pruebas Angular con DOM simulado y comprobaciones HTTP del build.
- No se certifican resultados fiscales, datos corporativos o series ajustadas que no estén en las entradas.

Los comandos reproducibles están en el README y el workflow `.github/workflows/ci.yml`.
