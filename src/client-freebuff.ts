/**
 * Cliente de la API local de Freebuff.
 *
 * Habla solo con la API REST del servidor local (loopback, sin token).
 * Endpoints documentados en docs/api-local-freebuff.md.
 */

import type { FreebuffConfig, ThreadMessage, ThreadSnapshot } from "./types.js";

export interface CrearHiloArgs {
  title?: string;
  model: string;
  reasoningEffort?: string;
  harnessId?: string;
}

export interface CrearHiloResultado {
  id: string;
  title?: string;
  model?: string;
}

export class FreebuffClientError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "FreebuffClientError";
    this.status = status;
  }
}

export class FreebuffClient {
  constructor(private cfg: FreebuffConfig) {}

  private get base(): string {
    return this.cfg.baseUrl.replace(/\/$/, "");
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch (e) {
      throw new FreebuffClientError(
        `No se pudo conectar con Freebuff en ${this.base}: ${(e as Error).message}`
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FreebuffClientError(
        `HTTP ${res.status} en ${path}: ${body.slice(0, 300)}`,
        res.status
      );
    }
    return (await res.json()) as T;
  }

  /** GET /api/auth/status → { authed, user } */
  async authStatus(): Promise<{ authed: boolean; user?: unknown; login?: string }> {
    return this.req("/api/auth/status");
  }

  /** POST /api/project/open — abre el proyecto en Freebuff. */
  async openProject(path: string): Promise<{ ok: boolean }> {
    return this.req("/api/project/open", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  }

  /** POST /api/threads — crea un hilo con el modelo dado. */
  async crearHilo(args: CrearHiloArgs): Promise<CrearHiloResultado> {
    const res = await this.req<{ ok?: boolean; thread?: CrearHiloResultado } & CrearHiloResultado>(
      "/api/threads",
      {
        method: "POST",
        body: JSON.stringify({
          projectPath: this.cfg.projectPath,
          title: args.title ?? "tarea-puente",
          harnessId: args.harnessId ?? this.cfg.harnessId ?? "codebuff",
          model: args.model,
          reasoningEffort: args.reasoningEffort ?? this.cfg.reasoningEffort ?? "high",
        }),
      }
    );
    // La API devuelve el thread directamente (con id en la raíz); por robustez
    // también aceptamos la forma envuelta { thread: {...} }.
    const hilo = res.thread && res.thread.id ? res.thread : (res as CrearHiloResultado);
    if (!hilo.id) throw new FreebuffClientError("La API no devolvió thread.id");
    return { id: hilo.id, title: hilo.title, model: hilo.model };
  }

  /** POST /api/thread/:id/message — envía un mensaje / inicia un turno. */
  async enviarMensaje(threadId: string, text: string): Promise<{ ok: boolean; queued?: boolean }> {
    return this.req(`/api/thread/${threadId}/message`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  }

  /** GET /api/thread/:id — snapshot con mensajes (≤50 con parche). */
  async snapshot(threadId: string): Promise<ThreadSnapshot> {
    return this.req<ThreadSnapshot>(`/api/thread/${threadId}`);
  }

  /**
   * Mensajes del snapshot, normalizados a `{ id, role, text }`.
   * El snapshot real usa `parts[]` con `kind: "text"`; extraemos el texto
   * acumulando todas las partes de texto del mensaje.
   */
  async mensajes(threadId: string): Promise<ThreadMessage[]> {
    const snap = await this.snapshot(threadId);
    return this.normalizarMensajes(snap.messages ?? []);
  }

  /**
   * Snapshot + mensajes normalizados en UNA sola petición GET.
   * Evita el doble fetch del mismo endpoint (mensajes + snapshot).
   */
  async snapshotNormalizado(threadId: string): Promise<{
    snap: ThreadSnapshot;
    mensajes: ThreadMessage[];
  }> {
    const snap = await this.snapshot(threadId);
    return { snap, mensajes: this.normalizarMensajes(snap.messages ?? []) };
  }

  /** Normaliza un mensaje crudo del snapshot a ThreadMessage. */
  private normalizarMensajes(raw: ThreadSnapshot["messages"]): ThreadMessage[] {
    return raw.map((m, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts = (m as unknown as { parts?: { kind?: string; text?: string }[] }).parts;
      let text = m.text ?? "";
      if (parts && Array.isArray(parts)) {
        text = parts
          .filter((p) => p.kind === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("\n");
      }
      return { id: m.id ?? String(i), role: m.role ?? "user", text, seq: m.seq, createdAt: m.createdAt };
    });
  }

  /** POST /api/thread/:id/stop — detiene el turno actual. */
  async stop(threadId: string): Promise<{ ok: boolean }> {
    return this.req(`/api/thread/${threadId}/stop`, { method: "POST", body: "{}" });
  }

  /* ------------------------------ Modo Misión ------------------------------ */

  async setMissionOn(threadId: string, on: boolean): Promise<{ ok: boolean }> {
    return this.req(`/api/thread/${threadId}/mission`, {
      method: "POST",
      body: JSON.stringify({ on }),
    });
  }

  async setMissionEffort(threadId: string, effort: number): Promise<{ ok: boolean }> {
    return this.req(`/api/thread/${threadId}/mission-effort`, {
      method: "POST",
      body: JSON.stringify({ effort }),
    });
  }

  async setMissionPrompt(threadId: string, prompt: string): Promise<{ ok: boolean }> {
    return this.req(`/api/thread/${threadId}/mission-prompt`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
  }

  /** GET /api/thread/:id/mission-receipts */
  async missionReceipts(threadId: string): Promise<unknown[]> {
    return this.req(`/api/thread/${threadId}/mission-receipts`);
  }
}
