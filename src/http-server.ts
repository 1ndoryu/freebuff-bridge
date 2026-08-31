/**
 * API HTTP local del puente.
 *
 * Permite que cualquier app (web, otro lenguaje, scripts) lance tareas sin
 * usar el SDK de Node:
 *   POST /task               { tarea, config? }  → crea y arranca una tarea
 *   GET  /task/:id           → estado/resultado de una tarea
 *   GET  /task/:id/events    → SSE de eventos de la tarea
 *   GET  /health             → ok
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { FreebuffBridge } from "./bridge.js";
import type { BridgeConfig, EventoTarea, ResultadoTarea } from "./types.js";
import { crearGestor } from "./gestor/types.js";

interface TareaEnMemoria {
  id: string;
  tarea: string;
  creadaEn: number;
  resultado: Promise<ResultadoTarea>;
  terminada: boolean;
  eventos: EventoTarea[];
  suscriptores: Set<(e: EventoTarea) => void>;
}

/** Retención base de una tarea terminada antes de evictarla. */
const TTL_BASE_MS = 60 * 60 * 1000; // 1 hora
/** Margen extra sobre el timeout total por defecto para no evictar tareas en curso. */
const TTL_MARGEN_MS = 10 * 60 * 1000; // 10 min
/** Límite de tareas retenidas en memoria (protege servidor de larga vida). */
const MAX_TAREAS = 200;

export class BridgeHttpServer {
  private server: ReturnType<typeof createServer>;
  private tareas = new Map<string, TareaEnMemoria>();
  private puerto: number;
  private host: string;
  private configFactory: () => BridgeConfig;

  constructor(configFactory: () => BridgeConfig, httpCfg: { puerto: number; host?: string }) {
    this.configFactory = configFactory;
    this.puerto = httpCfg.puerto;
    this.host = httpCfg.host ?? "127.0.0.1";
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  /** ¿Es un host/origen loopback permitido? */
  private esLoopback(host: string): boolean {
    const h = host.replace(/:\d+$/, "").toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  }

  /**
   * Evicción: borra tareas expiradas (TTL) y, si se supera el límite,
   * las más antiguas. Evita que el Map crezca sin límite en servidor largo.
   * El TTL nunca es menor que el timeout total de la config (más margen), y
   * las tareas aún en curso (`terminada: false`) nunca se evictan.
   */
  private evictar(): void {
    const cfg = this.configFactory();
    const ttlMs = Math.max(
      TTL_BASE_MS,
      (cfg.limites?.timeoutTotalMin ?? 60) * 60_000 + TTL_MARGEN_MS
    );
    const ahora = Date.now();
    for (const [id, t] of this.tareas) {
      if (t.terminada && ahora - t.creadaEn > ttlMs) this.tareas.delete(id);
    }
    while (this.tareas.size > MAX_TAREAS) {
      // Elimina la terminada más antigua; si no hay ninguna, se detiene
      // (no evictar tareas en curso).
      let vieja: string | null = null;
      let viejaTs = Infinity;
      for (const [id, t] of this.tareas) {
        if (t.terminada && t.creadaEn < viejaTs) {
          viejaTs = t.creadaEn;
          vieja = id;
        }
      }
      if (vieja === null) break;
      this.tareas.delete(vieja);
    }
  }

  private json(res: ServerResponse, code: number, body: unknown): void {
    const data = JSON.stringify(body);
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(data);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    // CORS básico para apps web en otro origen (loopback).
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // M2: solo se permite el acceso si el host y el origin son loopback
    // (evita CSRF si alguien expone el puerto por proxy o 0.0.0.0).
    const host = (req.headers.host ?? "").toLowerCase();
    const origin = (req.headers.origin ?? "").toLowerCase();
    const hostOk = !host || this.esLoopback(host);
    let originOk = !origin;
    if (!originOk) {
      try {
        // Compara hostname exacto (evita bypass tipo 127.0.0.1.evil.com).
        const u = new URL(origin);
        originOk = (u.protocol === "http:" || u.protocol === "https:") && this.esLoopback(u.hostname);
      } catch {
        originOk = false; // Origin malformado → denegar
      }
    }
    if (!hostOk || !originOk) {
      this.json(res, 403, { error: "acceso denegado: origen no loopback" });
      return;
    }

    if (req.method === "GET" && path === "/health") {
      this.json(res, 200, { ok: true, puerto: this.puerto });
      return;
    }

    if (req.method === "POST" && path === "/task") {
      this.evictar();
      const body = await this.readBody(req);
      const tarea = (body as { tarea?: string })?.tarea;
      if (!tarea || typeof tarea !== "string" || !tarea.trim()) {
        this.json(res, 400, { error: "campo 'tarea' requerido" });
        return;
      }
      const cfg = this.configFactory();
      const gestor = crearGestor(cfg.gestor);
      const bridge = new FreebuffBridge(cfg, gestor);

      const id = crypto.randomUUID();
      const entrada: TareaEnMemoria = {
        id,
        tarea,
        creadaEn: Date.now(),
        terminada: false,
        resultado: bridge.runTask(tarea, { onEvento: (e) => this.emit(entrada, e) }),
        eventos: [],
        suscriptores: new Set(),
      };
      // Marca la entrada como terminada cuando la promesa resuelve (para la evicción).
      void entrada.resultado.then(
        () => {
          entrada.terminada = true;
        },
        () => {
          entrada.terminada = true;
        }
      );
      this.tareas.set(id, entrada);
      this.json(res, 202, { id, threadId: undefined, estado: "lanzada" });
      return;
    }

    const mTask = path.match(/^\/task\/([^/]+)$/);
    if (req.method === "GET" && mTask) {
      const entrada = this.tareas.get(mTask[1]);
      if (!entrada) {
        this.json(res, 404, { error: "tarea no encontrada" });
        return;
      }
      const resultado = await entrada.resultado;
      this.json(res, 200, resultado);
      return;
    }

    const mEvents = path.match(/^\/task\/([^/]+)\/events$/);
    if (req.method === "GET" && mEvents) {
      const entrada = this.tareas.get(mEvents[1]);
      if (!entrada) {
        this.json(res, 404, { error: "tarea no encontrada" });
        return;
      }
      // SSE
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const suscriptor = (e: EventoTarea) => {
        res.write(`event: ${e.tipo}\ndata: ${JSON.stringify(e)}\n\n`);
      };
      // Replay de eventos previos.
      for (const ev of entrada.eventos) suscriptor(ev);
      entrada.suscriptores.add(suscriptor);
      req.on("close", () => entrada.suscriptores.delete(suscriptor));
      return;
    }

    this.json(res, 404, { error: "ruta no encontrada" });
  }

  private emit(entrada: TareaEnMemoria, e: EventoTarea): void {
    entrada.eventos.push(e);
    for (const s of entrada.suscriptores) s(e);
  }

  private readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
        } catch (e) {
          reject(new Error(`JSON inválido: ${(e as Error).message}`));
        }
      });
      req.on("error", reject);
    });
  }

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.puerto, this.host, () => {
        const addr = this.server.address();
        const port = typeof addr === "object" && addr ? addr.port : this.puerto;
        resolve(port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
