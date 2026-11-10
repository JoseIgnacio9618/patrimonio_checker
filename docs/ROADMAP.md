# Próximas extensiones

La aplicación local y las importaciones normalizadas están implementadas. Estas tareas requieren datos o infraestructura adicionales; no se presentan como terminadas:

1. Validar el CSV real de la cuenta, conservar un fixture anonimizado autorizado y añadir pruebas de regresión de sus 23 columnas o del formato que entregue el broker. Confirmar importes netos/brutos, tipos de movimiento, IDs y retenciones.
2. Probar el conector con autenticación del propietario en su equipo. Validar en vivo los detalles, mercados y tipos de eventos ya integrados. Ampliar los normalizadores de Saveback reinvertido y operaciones corporativas a partir de ejemplos reales.
3. Elegir un proveedor de cotizaciones con cobertura de ISIN y criptomonedas, históricos ajustados, divisas y licencia adecuada. Mantener procedencia, fechas, ajustes y errores por activo.
4. Importador Binance con lotes originales y enlace de traspasos para no duplicar entradas de BTC como nueva adquisición.
5. Separación contable y fiscal por cuenta, splits/fusiones, cambios FX, datos intradía y series de retorno total para comparativas consistentes.
6. Ampliar las comprobaciones visuales ya realizadas en Chromium a otros navegadores y una auditoría de accesibilidad.
7. Ampliar el motor fiscal a algoritmos y regímenes hoy no modelados, con validación fiscal profesional; los ficheros anuales actualizan parámetros, no incorporan reglas de cálculo nuevas.
8. Si se requiere despliegue remoto: autenticación, autorización, PostgreSQL, cifrado y gestión externa de secretos, copias automáticas y planificación independiente.
