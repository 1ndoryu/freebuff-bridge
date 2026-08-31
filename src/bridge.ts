/**
 * Orquestador del puente: máquina de estados + límites duros (anti-bucle).
 *
 * Flujo:
 *   planificar (opcional) → por cada paso: enviar mensaje → esperar fin (SSE)
 *   → leer snapshot → evaluar (opcional) → refinar o siguiente paso.
 *
 * Con gestor "ninguno" usa el modo Misión nativo de Freebuff: envía la tarea,
 * activa Misión y espera a que termine sola (receipts + SSE).
 */

import { FreebuffClient } from "./client-freebuff.js";
import { SseCliente } from "./client-sse.js";
import type { Gestor } from "./gestor/types.js";
import type {
  BridgeConfig,
  EstadoTarea,
  EventoTarea,
  ResultadoTarea,
  ThreadMessage,
} from "./types.js";

export interface OpcionesEjecucion {
  onEvento?: (e: EventoTarea) => void;
  signal?: AbortSignal;
}

/** Dependencias inyectables (para tests). */
export interface Dependencias {
  client?: FreebuffClient;
  sse?: SseCliente;
}

const DEFAULT_LLAMADAS = 20;
const DEFAULT_REFINAMIENTOS = 2;

export class FreebuffBridge {
  private client: FreebuffClient;
  private sse: SseCliente;
  private gestor: Gestor;
  private limites: BridgeConfig["limites"];
  private freebuffCfg: BridgeConfig["freebuff"];
  private esAutonomo: boolean;

  constructor(cfg: BridgeConfig, gestor: Gestor, deps: Dependencias = {}) {
    this.client = deps.client ?? new FreebuffClient(cfg.freebuff);
    this.sse = deps.sse ?? new SseCliente(cfg.freebuff);
    this.gestor = gestor;
    this.limites = cfg.limites;
    this.freebuffCfg = cfg.freebuff;
    this.esAutonomo = gestor.esAutonomo();
  }

  /** Envía un mensaje y espera el fin del turno (SSE) con timeout. */
  private async ejecutarTurno(
    threadId: string,
    prompt: string,
    timeoutMs: number,
    signal?: AbortSignal,
    onEvento?: (e: EventoTarea) => void
  ): Promise<void> {
    await this.client.enviarMensaje(threadId, prompt);

    const watchdogMin = Math.max(1, Math.ceil(this.limites.watchdogInactividadMin ?? 5));
    const ctrl = new AbortController();
    const abortar = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", abortar);

    try {
      const res = await Promise.race([
        this.sse.esperarFin(threadId, {
          watchdogMin,
          signal: ctrl.signal,
          onEvento: (ev) => {
            if (ev.type === "finish") onEvento?.({ tipo: "progreso", tareaId: threadId, paso: 0, total: 0, mensaje: "turno terminado" });
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout de paso (${Math.round(timeoutMs / 60000)} min)`)), timeoutMs)
        ),
      ]);
      // H6: si el stream se cerró sin finish y el turno sigue en curso, fallar.
      if (res && res.fin === false) {
        const snap = await this.client.snapshot(threadId).catch(() => null);
        if (snap?.thread?.turnState === "running") {
          throw new Error("El stream SSE se cerró sin señal de fin mientras el turno seguía en curso");
        }
      }
    } finally {
      ctrl.abort();
      if (signal) signal.removeEventListener("abort", abortar);
    }
  }

  /**
   * Espera a que la Misión termine: missionOn → false o missionStatus
   * "stopped", con polling + SSE y watchdog de actividad. El SSE se aborta
   * al terminar por polling para no dejar streams colgados.
   */
  private async esperarFinMision(
    threadId: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    const pollMs = this.limites.pollIntervalMs ?? 3000;
    const watchdogMin = Math.max(1, Math.ceil(this.limites.watchdogInactividadMin ?? 5));
    const inicio = Date.now();
    const ctrl = new AbortController();
    const abortar = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", abortar);

    // Suscripción SSE en paralelo (para actividad y detección de fin por eventos).
    const sseP = this.sse.esperarFin(threadId, { watchdogMin, signal: ctrl.signal }).catch(() => null);

    try {
      // Polling del snapshot: fin de misión cuando missionOn=false o missionStatus=stopped.
      while (Date.now() - inicio < timeoutMs) {
        if (signal?.aborted) throw new Error("Tarea cancelada por señal externa");
        const snap = await this.client.snapshot(threadId).catch(() => null);
        if (snap?.thread) {
          const t = snap.thread;
          const stopped =
            t.missionOn === false ||
            (t as { missionStatus?: { kind?: string } }).missionStatus?.kind === "stopped";
          if (stopped && t.turnState === "idle") {
            // Misión terminó: abortar el SSE antes de esperarlo.
            ctrl.abort();
            break;
          }
          // Si no quedó misión activa ni turnos en curso, terminó.
          if (!t.missionOn && t.turnState !== "running") {
            ctrl.abort();
            break;
          }
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      // Esperar a que el SSE se cierre limpio (abortado) antes de salir.
      await sseP;
      if (Date.now() - inicio >= timeoutMs) {
        throw new Error(`Timeout total de la tarea (${Math.round(timeoutMs / 60000)} min)`);
      }
    } finally {
      ctrl.abort();
      if (signal) signal.removeEventListener("abort", abortar);
      await sseP.catch(() => null);
    }
  }

  /**
   * Ejecuta una tarea end-to-end.
   * Devuelve el resultado final (completada/fallida/cancelada/timeout).
   */
  async runTask(tarea: string, opts: OpcionesEjecucion = {}): Promise<ResultadoTarea> {
    const tareaId = crypto.randomUUID();
    const iniciadaEn = new Date().toISOString();
    const timeoutTotalMs = this.limites.timeoutTotalMin * 60_000;
    const timeoutPasoMs = this.limites.timeoutPasoMin * 60_000;
    const maxLlamadas = this.limites.maxLlamadasGestor ?? DEFAULT_LLAMADAS;
    const maxRefinamientos = this.limites.maxRefinamientos ?? DEFAULT_REFINAMIENTOS;

    const emit = (e: EventoTarea) => opts.onEvento?.(e);
    let llamadasGestor = 0;
    let pasos: Awaited<ReturnType<Gestor["planificar"]>>["pasos"] = [];
    let pasoActual = 0;
    let threadId = "";
    let mensajes: ThreadMessage[] = [];
    let resumen = "";
    let receipts: ResultadoTarea["receipts"] = [];

    const resultado = (estado: EstadoTarea, error?: string): ResultadoTarea => ({
      id: tareaId,
      threadId,
      estado,
      resumen,
      pasos,
      pasoActual,
      llamadasGestor,
      mensajes,
      receipts,
      error,
      iniciadaEn,
      terminadaEn: new Date().toISOString(),
    });

    const guardarSnapshot = async () => {
      if (!threadId) return;
      try {
        const { snap, mensajes: msgs } = await this.client.snapshotNormalizado(threadId);
        mensajes = msgs;
        resumen = snap.thread.title ?? resumen;
      } catch {
        /* sin snapshot, seguir con lo último conocido */
      }
    };

    try {
      // 1. Abrir proyecto + crear hilo
      await this.client.openProject(this.freebuffCfg.projectPath);
      const hilo = await this.client.crearHilo({
        title: tarea.slice(0, 60),
        model: this.freebuffCfg.model,
        reasoningEffort: this.freebuffCfg.reasoningEffort,
        harnessId: this.freebuffCfg.harnessId,
      });
      threadId = hilo.id;
      emit({ tipo: "creada", tareaId, threadId });

      // 2. Planificar
      emit({ tipo: "progreso", tareaId, paso: 0, total: 0, mensaje: "planificando" });
      const ctx = { threadId, tarea, projectPath: this.freebuffCfg.projectPath, messages: [] };
      const plan = await this.gestor.planificar(tarea, ctx);
      llamadasGestor++;
      pasos = plan.pasos;
      if (pasos.length === 0) throw new Error("El gestor devolvió un plan sin pasos");
      emit({ tipo: "progreso", tareaId, paso: 0, total: pasos.length, mensaje: `plan: ${pasos.length} pasos` });

      // 3. Modo Misión si gestor autónomo ("ninguno")
      if (this.esAutonomo) {
        await this.client.setMissionOn(threadId, true);
        await this.client.setMissionEffort(threadId, 3);
        await this.client.setMissionPrompt(threadId, tarea);
      }

      // 4. Ejecutar
      if (this.esAutonomo) {
        // Envía el mensaje que arranca la Misión y espera a que termine sola.
        emit({ tipo: "progreso", tareaId, paso: 1, total: 1, mensaje: "modo Misión activado, Freebuff trabaja sola" });
        await this.client.enviarMensaje(threadId, tarea);
        await this.esperarFinMision(threadId, timeoutTotalMs, opts.signal);
        await guardarSnapshot();
      } else {
        for (const paso of pasos) {
          if (opts.signal?.aborted) return resultado("cancelada", "tarea cancelada por señal externa");
          pasoActual = paso.indice;
          emit({ tipo: "progreso", tareaId, paso: pasoActual, total: pasos.length, mensaje: `paso ${pasoActual}: ${paso.prompt.slice(0, 80)}` });
          await this.ejecutarTurno(threadId, paso.prompt, timeoutPasoMs, opts.signal, opts.onEvento);
          await guardarSnapshot();

          // Evaluar
          emit({ tipo: "progreso", tareaId, paso: pasoActual, total: pasos.length, mensaje: "evaluando" });
          const resultadoHilo = mensajes.map((m) => `${m.role}: ${m.text}`).join("\n");
          let refinamientos = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            if (llamadasGestor >= maxLlamadas) {
              return resultado("fallida", "presupuesto de llamadas al gestor agotado");
            }
            llamadasGestor++;
            const decision = await this.gestor.evaluar(
              paso,
              resultadoHilo.slice(-6000),
              { threadId, tarea, projectPath: this.freebuffCfg.projectPath, messages: mensajes }
            );
            if (decision.tipo === "ok") break;
            if (decision.tipo === "stop") return resultado("cancelada", decision.motivo);
            // refinar
            refinamientos++;
            if (refinamientos > maxRefinamientos) {
              return resultado("fallida", `máx. refinamientos (${maxRefinamientos}) superado en paso ${pasoActual}`);
            }
            emit({ tipo: "progreso", tareaId, paso: pasoActual, total: pasos.length, mensaje: `refinando (${refinamientos}/${maxRefinamientos})` });
            await this.ejecutarTurno(threadId, decision.prompt, timeoutPasoMs, opts.signal, opts.onEvento);
            await guardarSnapshot();
          }
        }
      }

      // 5. Cerrar: receipts (si Misión) y resultado
      if (this.esAutonomo) {
        try {
          const r = (await this.client.missionReceipts(threadId)) as ResultadoTarea["receipts"];
          receipts = Array.isArray(r) ? r : [];
        } catch {
          receipts = [];
        }
      }
      await guardarSnapshot();
      emit({ tipo: "fin", tareaId, estado: "completada", resumen });
      return resultado("completada");
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const esTimeout = /timeout/i.test(err) || /watchdog/i.test(err);
      const estado: EstadoTarea = esTimeout ? "timeout" : "fallida";
      emit({ tipo: "error", tareaId, error: err });
      emit({ tipo: "fin", tareaId, estado });
      await guardarSnapshot();
      return resultado(estado, err);
    }
  }
}
