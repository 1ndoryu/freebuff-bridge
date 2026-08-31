/**
 * Superficie pública del SDK freebuff-bridge.
 *
 * Uso:
 *   import { FreebuffBridge, crearGestor, cargarConfig } from "freebuff-bridge";
 *   const gestor = crearGestor(config.gestor);
 *   const bridge = new FreebuffBridge(config, gestor);
 *   const resultado = await bridge.runTask("mi tarea", { onEvento });
 *
 * Módulo barrel puro (solo re-exports): la lógica ejecutable vive en
 * config.ts / bridge.ts / client-*.ts / gestor/.
 */

export { FreebuffBridge } from "./bridge.js";
export type { OpcionesEjecucion } from "./bridge.js";
export { FreebuffClient, FreebuffClientError } from "./client-freebuff.js";
export { SseCliente, SseError } from "./client-sse.js";
export { cargarConfig } from "./config.js";
export {
  crearGestor,
  GestorGloryAPI,
  GestorOpenAICompatible,
  GestorNinguno,
} from "./gestor/types.js";
export type {
  BridgeConfig,
  Ctx,
  Decision,
  EstadoTarea,
  EventoTarea,
  FreebuffConfig,
  Gestor,
  GestorConfig,
  HttpConfig,
  LimitesConfig,
  Paso,
  Plan,
  ReceiptResumen,
  ResultadoTarea,
  ResultadoTareaMeta,
  ResultadoEjecucion,
  Role,
  ThreadMessage,
  ThreadSnapshot,
} from "./types.js";