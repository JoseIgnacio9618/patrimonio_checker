# Ejecutar la recogida periódica

Primero, desde la raíz del proyecto: `npm ci`, `npm run tr:connect`. En la app, activa el job y guarda su frecuencia. El servidor ya incluye el planificador: no necesitas un servicio extra si permanece encendido.

Para ejecutar también con el servidor web apagado, usa **una** de estas opciones. Son ejemplos para adaptar a tu ruta y usuario; la aplicación no instala servicios del sistema sin tu intervención.

## Linux / macOS con cron

Añade una entrada con `crontab -e`, sustituyendo las rutas. Usa la ruta absoluta de npm que obtengas con `command -v npm` y asegúrate de que Node 24 esté en el PATH de cron.

```cron
*/5 * * * * cd /ruta/patrimonio_checker && /ruta/a/npm run tr:sync -- --scheduled >> /ruta/privada/patrimonio-job.log 2>&1
```

Cron comprueba cada 5 minutos; la frecuencia efectiva es la guardada en Conexiones. Si configuraste 360 minutos, las comprobaciones intermedias omiten la recogida. Los cambios de hora del sistema pueden afectar a cuándo se despierta cron; el intervalo de la app usa instantes UTC.

## Linux con systemd de usuario

`~/.config/systemd/user/patrimonio-sync.service`:

```ini
[Unit]
Description=Recogida de Trade Republic

[Service]
Type=oneshot
WorkingDirectory=/ruta/patrimonio_checker
ExecStart=/ruta/a/npm run tr:sync -- --scheduled
```

`~/.config/systemd/user/patrimonio-sync.timer`:

```ini
[Unit]
Description=Comprobar el job de Patrimonio

[Timer]
OnBootSec=2min
OnUnitInactiveSec=1min

[Install]
WantedBy=timers.target
```

Actívalo con `systemctl --user daemon-reload` y `systemctl --user enable --now patrimonio-sync.timer`. Revisa con `systemctl --user list-timers` y `journalctl --user -u patrimonio-sync.service`. El servicio de usuario requiere la sesión activa salvo que el administrador configure permanencia del usuario. Ajusta el PATH del servicio si usas un gestor de versiones de Node.

## Windows

Crea una tarea en el **Programador de tareas** bajo el mismo usuario del login. Configura repetición cada 5 minutos, sin lanzar otra instancia si sigue ejecutándose.

- Programa: ruta absoluta a `cmd.exe`.
- Argumentos: `/c npm run tr:sync -- --scheduled`.
- Iniciar en: ruta absoluta a la carpeta `patrimonio_checker`.

Asegúrate de que Node 24 y npm estén en el PATH de la tarea. Si usas otra carpeta de datos, configura `PATRIMONIO_DATA_DIR` también en el entorno de esta tarea.

## Comportamiento compartido

El botón, el servidor y estos comandos usan el mismo código, frecuencia, bloqueo y registro de ejecuciones. Con `--scheduled`, un job desactivado, todavía no vencido, sin sesión o ya en curso se omite sin consultar al broker. El comando manual sin `--scheduled` fuerza una recogida, respetando el bloqueo. Un fallo se registra y devuelve un código de salida distinto de cero.

Las ejecuciones `success`, `partial` o `failed` se ven en Conexiones. `partial` significa que se guardaron los datos válidos y hay observaciones: por ejemplo, un activo sin cotización o un movimiento no interpretable. Una sesión caducada exige repetir `npm run tr:connect` desde una terminal interactiva.
