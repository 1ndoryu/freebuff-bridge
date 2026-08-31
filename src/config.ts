/**
 * Carga y validación de la configuración del puente.
 *
 * Separada del barrel público (`index.ts`) para que ese módulo sea unicamente
 * re-export (mixed-barrel-logic) y esta lógica ejecutable tenga hogar propio.
 */

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