# API local de Freebuff (referencia del cliente)

Esta es la API REST que expone la app de escritorio **Freebuff** (servidor local en
loopback, sin token) y que consume `FreebuffClient` (`src/client-freebuff.ts`).

> Endpoints verificados en el bundle de la app instalada
> (`resources/orchestrator/orchestrator.js`) y en la standalone de desarrollo
> (puerto 8788). La instalada escucha en el puerto 8787.

## Base

- Instalada: `http://127.0.0.1:8787`
- Standalone (dev): `http://127.0.0.1:8788`

Todas las rutas usan `content-type: application/json`. No hay token: solo se aceptan
orígenes loopback.

## Endpoints

### `GET /api/auth/status`

Estado de autenticación.

```json
{ "authed": true, "user": { ... }, "login": "andoryyu@gmail.com" }
```

### `POST /api/project/open`

Abre un proyecto en Freebuff.

```json
{ "path": "C:/ruta/al/proyecto" }
```

→ `{ "ok": true }`

### `POST /api/threads`

Crea un hilo con el modelo dado. **Importante:** pasar siempre el modelo explícito
(`deepseek/deepseek-v4-flash`); el default del servidor es premium.

```json
{
  "projectPath": "C:/ruta/al/proyecto",
  "title": "tarea-puente",
  "harnessId": "codebuff",
  "model": "deepseek/deepseek-v4-flash",
  "reasoningEffort": "high"
}
```

→ `{ "ok": true, "thread": { "id": "...", "title": "...", "model": "..." } }`

### `POST /api/thread/:id/message`

Envía un mensaje / inicia un turno.

```json
{ "text": "haz esto" }
```

→ `{ "ok": true, "queued": false }`

### `GET /api/thread/:id`

Snapshot del hilo. Con el parche `thread-snapshot` aplicado, `messages` son los últimos
**50** mensajes.

```json
{
  "thread": {
    "id": "...",
    "title": "...",
    "status": "...",
    "turnState": "idle" | "running" | "...",
    "missionOn": false,
    "model": "deepseek/deepseek-v4-flash"
  },
  "messages": [ { "id": "1", "role": "user", "text": "..." } ],
  "items": [ ... ]
}
```

### `GET /api/events` (SSE)

Stream de eventos con heartbeat `: ping` cada ~25 s. El fin de un turno llega como un
evento `agent` cuyo payload tiene `event.type === "finish"`.

```
event: state
data: {...}

event: thread
data: {...}

event: agent
data: {... "event": { "type": "finish" } ...}

: ping
```

### `POST /api/thread/:id/stop`

Detiene el turno actual.

```json
{}
```

→ `{ "ok": true }`

## Modo Misión (nativo)

Freebuff tiene un modo **Misión**: el agente trabaja en bucle hasta completar la tarea,
con un presupuesto (`effort`) y un prompt de misión. El manager de decisión (que también
gasta tokens) queda fuera de nuestro flujo: el puente lo sustituye.

### `POST /api/thread/:id/mission`

Activa/desactiva la Misión.

```json
{ "on": true }
```

→ `{ "ok": true, "thread": {...} }`

### `POST /api/thread/:id/mission-effort`

Presupuesto de la Misión (perfiles `MISSION_EFFORT_PROFILES`). Se usa `3` (Balanced).

```json
{ "effort": 3 }
```

Presupuestos conocidos (steps por perfil): 1→1/5/7 · 2→2/6/8 · 3→4/8/10 · 4→6/10/12 ·
5→8/12/14.

### `POST /api/thread/:id/mission-prompt`

Prompt de la Misión (máx. `MAX_MISSION_PROMPT_CHARS`).

```json
{ "prompt": "completa la tarea X" }
```

### `GET /api/thread/:id/mission-receipts`

Receipts de decisión de la Misión (tabla `auto_run_decision_receipts`, estados
`deciding | queued | running | completed | cancelled | interrupted`).

```json
[
  {
    "manager": { "costUsd": 0.001, "usage": { ... } },
    "outcome": { "toolCalls": 12, "changedFiles": [ "src/a.ts" ] }
  }
]
```

### `POST /api/queue/:itemId/:action`

Acciones sobre la cola (`pause`, `resume`, etc.).

## Detección del fin de Misión

El bridge espera el fin de la Misión comprobando el snapshot:

- `thread.missionOn === false`, **o**
- `thread.missionStatus.kind === "stopped"` con `turnState === "idle"`.

En paralelo se suscribe al SSE para detectar `finish` y vigilar actividad (watchdog).

## Notas

- **Modelo:** siempre `deepseek/deepseek-v4-flash` (no premium, `off_peak_only`).
- **Snapshot limitado:** sin el parche, el snapshot puede venir recortado; con el parche
  `thread-snapshot-limit-50` los `messages` son los últimos 50, suficiente para contexto.
- **Sin token:** el acceso está limitado a loopback por el servidor; no lo expongas a la
  red sin un proxy con control de acceso.
