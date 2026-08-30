# El port `Gestor` y sus implementaciones

El puente depende solo de una interfaz (port):

```ts
export interface Gestor {
  planificar(tarea: string, ctx: Ctx): Promise<Plan>;
  evaluar(paso: Paso, resultado: string, ctx: Ctx): Promise<Decision>;
}
```

El gestor **nunca ejecuta trabajo**: solo decide. La ejecución siempre la hace Freebuff
local (gratis). Esto mantiene el gasto en tokens del gestor mínimo y predecible.

## Contratos

### `planificar(tarea, ctx) → Plan`

Divide la tarea en pasos ejecutables.

- `tarea`: texto de la tarea pedida por la app.
- `ctx`: `{ threadId, tarea, projectPath, messages }` (mensajes actuales del hilo).
- Devuelve `Plan { pasos: Paso[] }` donde cada `Paso` es
  `{ prompt, criterio, indice }` (`prompt` = mensaje autocontenido que Freebuff enviará;
  `criterio` = cómo saber que el paso está completo; `indice` = 1-based).

### `evaluar(paso, resultado, ctx) → Decision`

Tras un turno, decide qué hacer con el paso.

- `resultado`: últimos mensajes del hilo (recortados a ~6000 chars).
- Devuelve `Decision`:
  - `{ tipo: "ok" }` — criterio cumplido, siguiente paso.
  - `{ tipo: "refinar", prompt }` — reintentar con un prompt corregido.
  - `{ tipo: "stop", motivo }` — no tiene sentido seguir (tarea completa o fracaso).

## Implementaciones

### `GestorGloryAPI` (`tipo: "gloryapi"`)

Habla con GloryAPI (`POST /v1/chat/completions`, clave unificada, Bearer). Usa un system
prompt que pide JSON estricto para `planificar` y `evaluar`, con fallback seguro:

- Si `planificar` no devuelve JSON → un solo paso con el texto como prompt.
- Si `evaluar` no devuelve JSON → `{ tipo: "ok" }` (no se bloquea la tarea).

Config:

```json
{
  "tipo": "gloryapi",
  "gloryapi": {
    "baseUrl": "http://127.0.0.1:4100/v1/chat/completions",
    "apiKey": "tu-clave-unificada",
    "model": "deepseek/deepseek-v4-flash"
  }
}
```

### `GestorOpenAICompatible` (`tipo: "openai"`)

Misma lógica que GloryAPI pero para **cualquier** endpoint compatible con
`/v1/chat/completions` (OpenAI, OpenRouter, LM Studio, etc.). Hereda de
`GestorGloryAPI`; solo cambia la configuración que se le pasa.

```json
{
  "tipo": "openai",
  "openai": {
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini"
  }
}
```

### `GestorNinguno` (`tipo: "ninguno"`)

Modo **autónomo**: no hay gestor externo. El bridge detecta
`gestor instanceof GestorNinguno` y usa el **modo Misión nativo de Freebuff**:

1. Activa `missionOn(true)`, fija `missionEffort(3)` y `missionPrompt(tarea)`.
2. Envía la tarea como mensaje.
3. Espera a que la Misión termine sola (polling del snapshot: `missionOn === false` o
   `missionStatus.kind === "stopped"` con `turnState === "idle"`), con SSE en paralelo.
4. Al final, lee los receipts de la Misión.

**Cero gasto en API**: Freebuff decide y trabaja sola con DeepSeek Flash.

```json
{ "tipo": "ninguno" }
```

## Cómo añadir una implementación propia

1. Implementa la interfaz `Gestor` (en `src/types.ts`).
2. Añade un archivo en `src/gestor/` (ej. `mi-gestor.ts`).
3. Expórtala desde `src/gestor/types.ts` y, si quieres configurarla desde JSON, añade su
   tipo a `GestorConfig` y su rama en `crearGestor()`.
4. Pásala al bridge: `new FreebuffBridge(cfg, miGestor)`.

Como el bridge solo depende del port, tu implementación puede llamar a cualquier servicio
(una API propia, un LLM local, reglas heurísticas...) sin tocar el resto del puente.

## Presupuesto de llamadas

El bridge cuenta cada `planificar`/`evaluar` como una llamada. Si se supera
`limites.maxLlamadasGestor`, la tarea termina como `fallida` con el motivo
`presupuesto de llamadas al gestor agotado`. Esto es la red de seguridad principal contra
bucles que gasten tokens.
