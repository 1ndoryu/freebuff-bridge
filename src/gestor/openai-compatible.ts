/**
 * Implementación del gestor contra CUALQUIER endpoint compatible con
 * OpenAI `/v1/chat/completions` (OpenAI, OpenRouter, LM Studio, etc.).
 */

import type { Ctx, Decision, Gestor, Paso, Plan } from "../types.js";
import { GestorGloryAPI } from "./gloryapi.js";

export interface OpenAiCompatibleCfg {
  baseUrl: string;
  apiKey: string;
  model?: string;
}

/**
 * Reutiliza la lógica de chat de GestorGloryAPI (ambos hablan el mismo
 * protocolo). La diferencia es solo la configuración.
 */
export class GestorOpenAICompatible extends GestorGloryAPI implements Gestor {
  constructor(cfg: OpenAiCompatibleCfg) {
    super({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
    });
  }
}
