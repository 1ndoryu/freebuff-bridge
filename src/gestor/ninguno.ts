/**
 * Implementación del gestor "ninguno" (modo autónomo).
 *
 * No hay gestor externo: Freebuff decide sola mediante su modo Misión nativo
 * (agente manager interno con DeepSeek Flash). El puente solo monitorea y
 * entrega el resultado.
 *
 * - planificar: devuelve un único paso que es la tarea como prompt de misión.
 * - evaluar: siempre "ok" (el fin de Misión es el criterio de éxito).
 */

import type { Ctx, Decision, Gestor, Paso, Plan } from "../types.js";

export class GestorNinguno implements Gestor {
  async planificar(tarea: string): Promise<Plan> {
    return {
      pasos: [{ prompt: tarea, criterio: "completar la tarea (fin de Misión)", indice: 1 }],
      nota: "modo autónomo: Freebuff decide los pasos con su Misión nativa",
    };
  }

  async evaluar(_paso: Paso, _resultado: string, _ctx: Ctx): Promise<Decision> {
    return { tipo: "ok" };
  }
}
