# freebuff-bridge

Puente agnóstico entre tu aplicación y **Freebuff** (la app de escritorio que corre como
servidor local). El puente **solo decide y orquesta**; el trabajo pesado lo hace Freebuff
gratis con el modelo DeepSeek Flash.

> **Idea clave:** tu app pide una tarea → el bridge la planifica (con un gestor IA externo
> opcional o en modo autónomo) → Freebuff la ejecuta localmente → el bridge evalúa y
> entrega un resultado estructurado. El gestor externo solo gasta tokens **decidiendo**,
> nunca ejecutando.

## Características

- **SDK agnóstico (TypeScript):** un port `Gestor` con 3 implementaciones (`gloryapi`,
  `openai`, `ninguno`). Integrable en cualquier aplicación que hable TypeScript/Node.
- **Modo autónomo:** sin gestor externo, Freebuff trabaja sola en bucle con su **modo
  Misión** nativo (`missionOn` + `mission-effort` + `mission-prompt`). Cero gasto en API.
- **Modo dirigido:** un gestor externo planifica en pasos, evalúa resultados y puede
  refinar (con límites duros anti-bucle).
- **API HTTP local:** `POST /task`, `GET /task/:id`, `GET /task/:id/events` (SSE),
  `GET /health` — usable desde cualquier lenguaje o app web.
- **CLI:** `run`, `server`, `status`.
- **Límites duros (anti-bucle):** timeout por paso, timeout total, watchdog de inactividad
  del SSE, máximo de refinamientos, máximo de llamadas al gestor.
- **Tests:** suite con `node:test` + `tsx`, sin dependencias de red (fetch stubbeado).

## Requisitos

- Node.js ≥ 20 (probado con Node 24) y npm.
- **Freebuff Desktop** corriendo en loopback con su API local (por defecto
  `http://127.0.0.1:8787`; la standalone de desarrollo usa `http://127.0.0.1:8788`).
- Opcional: una API compatible con OpenAI (`/v1/chat/completions`) como GloryAPI para el
  modo dirigido.

## Instalación

```bash
cd freebuff-bridge
npm install
cp config.example.json config.json   # edita baseUrl, projectPath y gestor
npm run type-check                    # comprueba tipos
npm test                              # suite de tests
```

## Uso rápido (CLI)

```bash
# Estado de la conexión con Freebuff
npm run cli -- status

# Tarea con gestor externo (planifica + evalúa)
npm run cli -- run "crea un README en el proyecto" --config config.json

# Modo autónomo: Freebuff decide y trabaja sola (Misión)
npm run cli -- run "revisa y corrige los tests" --autonomo

# Servidor HTTP para cualquier app
npm run cli -- server --port 4200
```

## Uso como SDK

```ts
import { FreebuffBridge, crearGestor, cargarConfig } from "freebuff-bridge";

const cfg = cargarConfig("./config.json");
const gestor = crearGestor(cfg.gestor);
const bridge = new FreebuffBridge(cfg, gestor);

const resultado = await bridge.runTask("haz X", {
  onEvento: (e) => console.log(e),
});
console.log(resultado.estado, resultado.threadId, resultado.mensajes.length);
```

El `bridge.runTask` devuelve un `ResultadoTarea` con `estado`
(`completada | fallida | cancelada | timeout`), los pasos ejecutados, el número de llamadas
al gestor, los mensajes del hilo y (en modo Misión) los receipts.

## Configuración

Ver [`config.example.json`](./config.example.json). Los campos clave:

| Sección | Campo | Descripción |
|---|---|---|
| `freebuff` | `baseUrl` | URL de la API local de Freebuff |
| `freebuff` | `projectPath` | Proyecto donde Freebuff ejecutará la tarea |
| `freebuff` | `model` | Modelo de Freebuff (siempre `deepseek/deepseek-v4-flash`) |
| `gestor` | `tipo` | `gloryapi` \| `openai` \| `ninguno` |
| `gestor` | `gloryapi`/`openai` | `baseUrl`, `apiKey`, `model` del endpoint |
| `limites` | `timeoutPasoMin` | Timeout por paso (min) |
| `limites` | `timeoutTotalMin` | Timeout total (min) |
| `limites` | `watchdogInactividadMin` | Sin actividad SSE → detener (min) |
| `limites` | `maxRefinamientos` | Refinamientos máx. por paso |
| `limites` | `maxLlamadasGestor` | Llamadas máx. al gestor por tarea |
| `http` | `puerto`/`host` | Servidor HTTP del bridge (por defecto 4200/127.0.0.1) |

## API HTTP

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/task` | `{ "tarea": "..." }` → `202 { id, estado: "lanzada" }` |
| `GET` | `/task/:id` | Estado/resultado final de la tarea |
| `GET` | `/task/:id/events` | SSE de eventos (`creada`, `progreso`, `fin`, `error`) con replay |
| `GET` | `/health` | `{ ok: true }` |

El servidor es **loopback por defecto** (`127.0.0.1`) y no exige token; solo úsalo en la
máquina local o detrás de un proxy con control de acceso.

## Arquitectura

```
tu app ──▶ bridge (SDK / HTTP) ──▶ Freebuff local (API REST + SSE)
              │
              └── gestor (port) ──▶ GloryAPI | OpenAI | ninguno (Misión)
```

- `src/bridge.ts` — orquestador: máquina de estados + límites duros.
- `src/client-freebuff.ts` — cliente de la API local de Freebuff.
- `src/client-sse.ts` — suscripción al SSE con watchdog.
- `src/gestor/` — port `Gestor` + implementaciones.
- `src/http-server.ts` — API HTTP para integraciones externas.
- `src/cli/main.ts` — CLI.

## Documentación

- [`docs/integracion.md`](./docs/integracion.md) — cómo integrar el bridge en una app.
- [`docs/gestores.md`](./docs/gestores.md) — el port `Gestor` y sus implementaciones.
- [`docs/api-local-freebuff.md`](./docs/api-local-freebuff.md) — la API local de Freebuff
  que usa el cliente (endpoints verificados en el bundle).

## Tests

```bash
npm test          # node:test + tsx (15 tests)
npm run type-check
```

Los tests usan mocks inyectados (cliente y SSE) y un stub de `globalThis.fetch`; no tocan
red ni la instancia real de Freebuff.

## Licencia

Privado / uso interno del área de trabajo. Sin dependencias de red obligatorias.
