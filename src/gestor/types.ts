/**
 * Port del Gestor: tipos y fábrica por configuración.
 */

import type { Ctx, Decision, Gestor, GestorConfig, Paso, Plan } from "../types.js";

export type { Ctx, Decision, Gestor, Paso, Plan };

/** Implementaciones concretas. */
import { GestorGloryAPI } from "./gloryapi.js";
import { GestorOpenAICompatible } from "./openai-compatible.js";
import { GestorNinguno } from "./ninguno.js";

export { GestorGloryAPI, GestorOpenAICompatible, GestorNinguno };

/** Crea el gestor según la configuración (port/adapter). */
export function crearGestor(cfg: GestorConfig): Gestor {
  switch (cfg.tipo) {
    case "gloryapi":
      if (!cfg.gloryapi) throw new Error("config.gestor.gloryapi requerido para tipo gloryapi");
      if (!cfg.gloryapi.apiKey) throw new Error("config.gestor.gloryapi.apiKey requerida");
      return new GestorGloryAPI(cfg.gloryapi);
    case "openai":
      if (!cfg.openai) throw new Error("config.gestor.openai requerido para tipo openai");
      if (!cfg.openai.apiKey) throw new Error("config.gestor.openai.apiKey requerida");
      return new GestorOpenAICompatible(cfg.openai);
    case "ninguno":
      return new GestorNinguno();
    default:
      throw new Error(`Tipo de gestor desconocido: ${(cfg as { tipo: string }).tipo}`);
  }
}
