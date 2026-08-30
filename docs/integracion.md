# Integración del bridge en una aplicación

`freebuff-bridge` es un **SDK agnóstico**: no impone framework ni lenguaje de UI. Puedes
integrarlo desde una app Node/TypeScript (SDK directo), desde cualquier lenguaje (API HTTP)
o desde un script (CLI).

## 1. Patrón general

```
tu app
  │
  ├─ (A) SDK: import { FreebuffBridge } → runTask() → ResultadoTarea
  ├─ (B) HTTP: POST /task → GET /task/:id (+ SSE de eventos)
  └─ (C) CLI:  freebuff-bridge run "tarea"
```

Las tres vías comparten la misma lógica (`src/bridge.ts`) y la misma configuración.

## 2. Integración con el SDK (TypeScript)

```ts
import { FreebuffBridge, crearGestor, cargarConfig } from "freebuff-bridge";
import type { EventoTarea, ResultadoTarea } from "freebuff-bridge";

const cfg = cargarConfig("./config.json");

// 1. Gestor: decide (planificar/evaluar). Puede ser gloryapi, openai o ninguno.
const gestor = crearGestor(cfg.gestor);

// 2. Bridge con límites duros ya configurados en config.json.
const bridge = new FreebuffBridge(cfg, gestor);

// 3. Lanza la tarea y escucha eventos.
const resultado: ResultadoTarea = await bridge.runTask("actualiza el README", {
  onEvento: (e: EventoTarea) => {
    if (e.tipo === "creada") console.log(`hilo ${e.threadId} creado`);
    if (e.tipo === "progreso") console.log(`paso ${e.paso}/${e.total}: ${e.mensaje}`);
    if (e.tipo === "fin") console.log(`estado final: ${e.estado}`);
  },
});

if (resultado.estado === "completada") {
  console.log("Resumen:", resultado.resumen);
  console.log("Mensajes del hilo:", resultado.mensajes);
} else {
  console.error("Falló:", resultado.error);
}
```

### Eventos (`EventoTarea`)

| Evento | Campos | Cuándo |
|---|---|---|
| `creada` | `tareaId`, `threadId` | El hilo se creó en Freebuff |
| `progreso` | `tareaId`, `paso`, `total`, `mensaje` | Avance de la tarea |
| `fin` | `tareaId`, `estado`, `resumen` | Terminó (completada/fallida/timeout) |
| `error` | `tareaId`, `error` | Error interno del bridge |

### Límites duros por tarea

Siempre están activos (desde `config.json` → `limites`):

- `timeoutPasoMin`: un turno no puede durar más que esto.
- `timeoutTotalMin`: la tarea completa no puede exceder esto.
- `watchdogInactividadMin`: si el SSE deja de emitir (ni pings), se detiene.
- `maxRefinamientos`: máximo de reintentos de un paso.
- `maxLlamadasGestor`: presupuesto de tokens/llamadas del gestor externo.

## 3. Integración con la API HTTP (cualquier lenguaje)

Arranca el servidor:

```bash
npm run cli -- server --config config.json --port 4200
# [freebuff-bridge] Servidor HTTP escuchando en http://127.0.0.1:4200
```

Lanza una tarea:

```bash
curl -X POST http://127.0.0.1:4200/task \
  -H "content-type: application/json" \
  -d '{"tarea":"crea una landing en el proyecto"}'
# {"id":"<uuid>","estado":"lanzada"}
```

Consulta el resultado (bloquea hasta que termina):

```bash
curl http://127.0.0.1:4200/task/<uuid>
# {"id":..., "estado":"completada", "threadId":..., "pasos":[...], "mensajes":[...]}
```

Escucha los eventos en tiempo real (SSE con replay):

```bash
curl -N http://127.0.0.1:4200/task/<uuid>/events
# event: creada
# data: {...}
```

> El servidor es loopback por defecto y sin autenticación: úsalo en la máquina local.
> Para exponerlo, ponlo detrás de un proxy/API gateway con control de acceso.

## 4. Integración desde CLI

```bash
# Una sola tarea (exit code 0 si completada)
npm run cli -- run "tarea" --config config.json

# Modo autónomo (sin gastar en el gestor)
npm run cli -- run "tarea" --autonomo

# Estado de la conexión
npm run cli -- status
```

## 5. Configuración desde código (sin archivo)

```ts
import { FreebuffBridge, GestorNinguno } from "freebuff-bridge";

const cfg = {
  freebuff: {
    baseUrl: "http://127.0.0.1:8788",
    projectPath: "C:/tmp/fb-bridge-test",
    model: "deepseek/deepseek-v4-flash",
    reasoningEffort: "high",
    harnessId: "codebuff",
  },
  gestor: { tipo: "ninguno" },
  limites: {
    timeoutPasoMin: 30,
    timeoutTotalMin: 120,
    watchdogInactividadMin: 5,
    maxRefinamientos: 2,
    maxLlamadasGestor: 20,
  },
};

const bridge = new FreebuffBridge(cfg, new GestorNinguno());
const r = await bridge.runTask("migra el modelo de datos");
```

## 6. Inyección de dependencias (tests / entornos raros)

El constructor acepta dependencias opcionales (cliente y SSE) para pruebas o para usar
implementaciones alternativas sin tocar la red:

```ts
const bridge = new FreebuffBridge(cfg, gestor, { client, sse });
```

Si no se pasan, se crean automáticamente con `cfg.freebuff`.

## 7. Buenas prácticas

- **Usa siempre el modelo DeepSeek Flash** en Freebuff (`deepseek/deepseek-v4-flash`);
  el modelo por defecto del servidor es premium y gasta.
- Pon límites razonables según la tarea; empieza con `timeoutTotalMin` pequeño y súbelo
  si la tarea es larga.
- En producción, no expongas `apiKey` del gestor en el cliente; sirve la tarea desde tu
  backend usando la API HTTP del bridge.
- Consulta `GET /task/:id` para resultados duraderos; el SSE es para progreso en vivo.
