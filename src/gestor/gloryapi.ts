/**
 * Implementación del gestor contra GloryAPI (endpoint OpenAI-compatible).
 *
 * GloryAPI expone `POST /v1/chat/completions` con una clave unificada.
 * El gestor solo decide (planificar/evaluar) y nunca trabaja: la ejecución
 * la hace Freebuff local.
 */

import type { Ctx, Decision, Gestor, Paso, Plan } from "../types.js";

export interface GloryApiCfg {
  baseUrl: string;
  apiKey: string;
  model?: string;
}

const MODELO_DEFECTO = "deepseek/deepseek-v4-flash";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class GestorGloryAPI implements Gestor {
  private cfg: GloryApiCfg;

  constructor(cfg: GloryApiCfg) {
    this.cfg = cfg;
  }

  private async chat(messages: ChatMessage[]): Promise<string> {
    const res = await fetch(this.cfg.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model ?? MODELO_DEFECTO,
        messages,
        max_tokens: 1200,
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GloryAPI ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  }

  /** Convierte la salida del gestor en un Plan estructurado (JSON). */
  private parsePlan(texto: string): Plan {
    const json = texto
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");
    try {
      const obj = JSON.parse(json) as { pasos?: { prompt: string; criterio: string }[] };
      const pasos = (obj.pasos ?? []).map((p, i) => ({
        prompt: p.prompt,
        criterio: p.criterio,
        indice: i + 1,
      }));
      if (pasos.length === 0) throw new Error("plan sin pasos");
      return { pasos };
    } catch {
      // Fallback: un único paso con el texto como prompt.
      return {
        pasos: [{ prompt: texto.trim(), criterio: "completar la tarea", indice: 1 }],
        nota: "el gestor no devolvió JSON; se usó el texto como un solo paso",
      };
    }
  }

  async planificar(tarea: string, ctx: Ctx): Promise<Plan> {
    const system = `Eres el planificador de un puente. Recibes una tarea y el contexto de un hilo de Freebuff.
Devuelve SOLO JSON con esta forma: {"pasos":[{"prompt":"...","criterio":"..."}]}
- Cada "prompt" es un mensaje ejecutable que Freebuff enviará (instrucción clara y autocontenida).
- Cada "criterio" describe cómo saber que ese paso está completo.
- Máximo 5 pasos. Sé conciso y específico.`;
    const user = `Tarea: ${tarea}\nProyecto: ${ctx.projectPath}\nMensajes actuales: ${ctx.messages.length}`;
    return this.parsePlan(await this.chat([{ role: "system", content: system }, { role: "user", content: user }]));
  }

  async evaluar(paso: Paso, resultado: string, ctx: Ctx): Promise<Decision> {
    const system = `Eres el evaluador de un puente Freebuff. Recibes un paso, su criterio y el resultado del hilo.
Decide SOLO JSON: {"tipo":"ok"|"refinar"|"stop","prompt":"...","motivo":"..."}
- "ok": el criterio se cumplió.
- "refinar": el criterio NO se cumplió y conviene reintentar con un nuevo prompt de corrección.
- "stop": no tiene sentido seguir (fracaso o tarea completa).`;
    const user = `Paso ${paso.indice}: ${paso.prompt}\nCriterio: ${paso.criterio}\n\nResultado del hilo (últimos mensajes):\n${resultado}`;
    const salida = await this.chat([{ role: "system", content: system }, { role: "user", content: user }]);
    try {
      const obj = JSON.parse(salida.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")) as {
        tipo?: string;
        prompt?: string;
        motivo?: string;
      };
      if (obj.tipo === "ok") return { tipo: "ok" };
      if (obj.tipo === "refinar") return { tipo: "refinar", prompt: obj.prompt ?? paso.prompt };
      if (obj.tipo === "stop") return { tipo: "stop", motivo: obj.motivo ?? "criterio no alcanzable" };
    } catch {
      /* fallthrough */
    }
    return { tipo: "ok" };
  }
}
