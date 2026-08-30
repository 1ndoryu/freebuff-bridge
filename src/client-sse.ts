/**
 * Suscripción al SSE de Freebuff (/api/events) con watchdog de actividad.
 *
 * El servidor emite eventos `state`, `thread` y `agent`, más un heartbeat
 * `: ping` cada 25 s. El fin de un turno llega como un evento `agent` con
 * `event.type === "finish"`.
 */

import type { FreebuffConfig } from "./types.js";

export type EventoSSE =
  | { type: "state"; data: unknown }
  | { type: "thread"; data: unknown }
  | { type: "agent"; data: unknown }
  | { type: "ping" }
  | { type: "finish"; data?: unknown }
  | { type: "desconocido"; data: string };

export interface SseOpciones {
  /** Minutos sin ningún evento (incl. ping) antes de declarar watchdog. */
  watchdogMin?: number;
  /** Callback por cada evento parseado. */
  onEvento?: (e: EventoSSE) => void;
  /** Cuando el watchdog se dispara (sin actividad). */
  onWatchdog?: () => void;
  signal?: AbortSignal;
}

interface Resolucion {
  fin: boolean;
  ultimoEvento: EventoSSE | null;
}

export class SseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseError";
  }
}

export class SseCliente {
  constructor(private cfg: FreebuffConfig) {}

  private get base(): string {
    return this.cfg.baseUrl.replace(/\/$/, "");
  }

  /**
   * Abre el stream y resuelve cuando ve un evento `agent` con type "finish",
   * o rechaza si el watchdog se dispara sin actividad.
   */
  async esperarFin(threadId: string, opts: SseOpciones = {}): Promise<Resolucion> {
    const watchdogMs = (opts.watchdogMin ?? 5) * 60_000;
    const ctrl = new AbortController();
    if (opts.signal) opts.signal.addEventListener("abort", () => ctrl.abort());

    let ultimoEvento: EventoSSE | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let terminado = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolve: (r: Resolucion) => void = () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let reject: (e: Error) => void = () => {};
    const done = new Promise<Resolucion>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const resolver = (r: Resolucion) => {
      if (terminado) return;
      terminado = true;
      if (watchdogTimer) clearTimeout(watchdogTimer);
      ctrl.abort();
      resolve(r);
    };
    const rechazar = (e: Error) => {
      if (terminado) return;
      terminado = true;
      if (watchdogTimer) clearTimeout(watchdogTimer);
      ctrl.abort();
      reject(e);
    };

    const armarWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        if (terminado) return;
        opts.onWatchdog?.();
        rechazar(new SseError(`Watchdog: sin actividad del SSE en ${opts.watchdogMin ?? 5} min`));
      }, watchdogMs);
    };

    try {
      const res = await fetch(`${this.base}/api/events`, {
        headers: { accept: "text/event-stream" },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new SseError(`SSE falló: HTTP ${res.status}`);
      }

      armarWatchdog();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done: fin, value } = await reader.read();
        if (fin) break;
        buffer += decoder.decode(value, { stream: true });
        const partes = buffer.split("\n\n");
        buffer = partes.pop() ?? "";
        for (const parte of partes) {
          const evento = this.parseEvento(parte);
          if (!evento) continue;
          armarWatchdog();
          ultimoEvento = evento;
          opts.onEvento?.(evento);
          if (evento.type === "finish") {
            resolver({ fin: true, ultimoEvento });
            return done;
          }
        }
      }
      // El stream se cerró sin ver finish.
      resolver({ fin: false, ultimoEvento });
    } catch (e) {
      if (terminado) return done;
      rechazar(e instanceof Error ? e : new SseError(String(e)));
    }

    return done;
  }

  /** Convierte un bloque SSE (puede ser comentario `: ping`) a EventoSSE. */
  private parseEvento(bloque: string): EventoSSE | null {
    const lineas = bloque.split("\n");
    let event = "";
    const datos: string[] = [];
    for (const l of lineas) {
      if (l.startsWith(":")) continue; // comentario/heartbeat
      if (l.startsWith("event:")) event = l.slice(6).trim();
      else if (l.startsWith("data:")) datos.push(l.slice(5).trim());
    }
    if (!event) return null; // heartbeat puro
    const data = datos.join("\n");
    let parsed: unknown;
    try {
      parsed = data ? JSON.parse(data) : {};
    } catch {
      parsed = data;
    }
    if (event === "agent" && typeof parsed === "object" && parsed !== null) {
      const obj = parsed as { event?: { type?: string } };
      if (obj.event?.type === "finish") return { type: "finish", data: parsed };
    }
    if (event === "state") return { type: "state", data: parsed };
    if (event === "thread") return { type: "thread", data: parsed };
    if (event === "agent") return { type: "agent", data: parsed };
    if (event === "ping") return { type: "ping" };
    return { type: "desconocido", data: typeof parsed === "string" ? parsed : JSON.stringify(parsed) };
  }
}
