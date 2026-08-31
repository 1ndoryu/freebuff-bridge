/**
 * Superficie pública del SDK freebuff-bridge.
 *
 * Uso:
 *   import { FreebuffBridge, crearGestor, cargarConfig } from "freebuff-bridge";
 *   const gestor = crearGestor(config.gestor);
 *   const bridge = new FreebuffBridge(config, gestor);
 *   const resultado = await bridge.runTask("mi tarea", { onEvento });
 */

export { FreebuffBridge } from "./bridge.js";
export type { OpcionesEjecucion } from "./bridge.js";
export { FreebuffClient, FreebuffClientError } from "./client-freebuff.js";
export { SseCliente, SseError } from "./client-sse.js";
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
  Role,
  ThreadMessage,
  ThreadSnapshot,
} from "./types.js";

import { readFileSync } from "node:fs";
import type { BridgeConfig } from "./types.js";

/**
 * Carga la configuración desde un JSON (compatible con config.example.json).
 */
export function cargarConfig(ruta: string): BridgeConfig {
  const raw = readFileSync(ruta, "utf8");
  const cfg = JSON.parse(raw) as BridgeConfig;
  // Validación mínima
  if (!cfg.freebuff?.baseUrl || !cfg.freebuff?.projectPath || !cfg.freebuff?.model) {
    throw new Error("config.freebuff requiere baseUrl, projectPath y model");
  }
  if (!cfg.gestor?.tipo) {
    throw new Error("config.gestor.tipo requerido (gloryapi|openai|ninguno)");
  }
  if (cfg.gestor.tipo === "gloryapi" && !cfg.gestor.gloryapi?.apiKey) {
    throw new Error("config.gestor.gloryapi.apiKey requerida para tipo gloryapi");
  }
  if (cfg.gestor.tipo === "openai" && !cfg.gestor.openai?.apiKey) {
    throw new Error("config.gestor.openai.apiKey requerida para tipo openai");
  }
  if (!cfg.limites?.timeoutPasoMin || !cfg.limites?.timeoutTotalMin) {
    throw new Error("config.limites requiere timeoutPasoMin y timeoutTotalMin");
  }
  return cfg;
}
