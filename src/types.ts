/**
 * Tipos públicos del SDK freebuff-bridge.
 *
 * Definiciones de la configuración, los mensajes del hilo de Freebuff,
 * la interfaz del gestor (port) y los resultados de una tarea.
 */

/* ---------------------------------- Config --------------------------------- */

export interface FreebuffConfig {
  /** URL base de la API local de Freebuff. Ej: http://127.0.0.1:8787 */
  baseUrl: string;
  /** Ruta del proyecto donde Freebuff ejecutará la tarea. */
  projectPath: string;
  /** Modelo de Freebuff (siempre DeepSeek Flash). */
  model: string;
  /** Esfuerzo de razonamiento: low | high | max. */
  reasoningEffort?: "low" | "high" | "max";
  /** Harness del agente. Por defecto "codebuff". */
  harnessId?: string;
}

export interface GestorConfig {
  /**
   * Tipo de gestor:
   * - "gloryapi": endpoint GloryAPI (OpenAI-compatible).
   * - "openai": cualquier endpoint compatible con /v1/chat/completions.
   * - "ninguno": sin gestor externo; Freebuff decide sola (modo Misión).
   */
  tipo: "gloryapi" | "openai" | "ninguno";
  gloryapi?: {
    baseUrl: string;
    apiKey: string;
    model?: string;
  };
  openai?: {
    baseUrl: string;
    apiKey: string;
    model?: string;
  };
}

export interface LimitesConfig {
  /** Timeout máximo por paso, en minutos. */
  timeoutPasoMin: number;
  /** Timeout máximo total de la tarea, en minutos. */
  timeoutTotalMin: number;
  /** Minutos sin actividad en el SSE antes de detener (watchdog). */
  watchdogInactividadMin: number;
  /** Máximo de refinamientos por paso. */
  maxRefinamientos: number;
  /** Máximo de llamadas al gestor por tarea. */
  maxLlamadasGestor: number;
  /** Intervalo de polling del snapshot como fallback del SSE, en ms. */
  pollIntervalMs?: number;
}

export interface HttpConfig {
  puerto: number;
  host?: string;
}

export interface BridgeConfig {
  freebuff: FreebuffConfig;
  gestor: GestorConfig;
  limites: LimitesConfig;
  http?: HttpConfig;
}

/* ------------------------------ Mensajes de hilo ----------------------------- */

export type Role = "user" | "assistant" | "system";

export interface ThreadMessage {
  id: string;
  role: Role;
  text: string;
  seq?: number;
  createdAt?: string;
}

export interface ThreadSnapshot {
  thread: {
    id: string;
    title?: string;
    status?: string;
    turnState?: string;
    queuePaused?: boolean;
    missionOn?: boolean;
    model?: string;
    projectPath?: string;
  };
  messages: ThreadMessage[];
  items?: unknown[];
}

/* ------------------------------ Interfaz Gestor ----------------------------- */

export interface Ctx {
  threadId: string;
  tarea: string;
  projectPath: string;
  /** Mensajes actuales del hilo (máx. 50). */
  messages: ThreadMessage[];
}

export interface Paso {
  /** Prompt ejecutable que se envía a Freebuff. */
  prompt: string;
  /** Criterio de éxito (descripción para el gestor). */
  criterio: string;
  /** ID secuencial del paso (1-based). */
  indice: number;
}

export interface Plan {
  pasos: Paso[];
  /** Nota opcional del gestor. */
  nota?: string;
}

export type Decision =
  | { tipo: "ok" }
  | { tipo: "refinar"; prompt: string; nota?: string }
  | { tipo: "stop"; motivo: string };

/**
 * Port del gestor. El puente solo depende de esta interfaz.
 * Implementaciones: gloryapi.ts, openai-compatible.ts, ninguno.ts.
 */
export interface Gestor {
  planificar(tarea: string, ctx: Ctx): Promise<Plan>;
  evaluar(paso: Paso, resultado: string, ctx: Ctx): Promise<Decision>;
}

/* -------------------------------- Resultado -------------------------------- */

export type EstadoTarea =
  | "planificando"
  | "ejecutando"
  | "evaluando"
  | "refinando"
  | "completada"
  | "fallida"
  | "cancelada"
  | "timeout";

export interface ReceiptResumen {
  manager?: {
    costUsd?: number;
    usage?: unknown;
  };
  outcome?: {
    toolCalls?: number;
    changedFiles?: string[];
  };
}

export interface ResultadoTarea {
  id: string;
  threadId: string;
  estado: EstadoTarea;
  resumen?: string;
  pasos: Paso[];
  pasoActual: number;
  llamadasGestor: number;
  mensajes: ThreadMessage[];
  receipts?: ReceiptResumen[];
  error?: string;
  iniciadaEn: string;
  terminadaEn?: string;
}

/* ------------------------------ Eventos del SDK ----------------------------- */

export type EventoTarea =
  | { tipo: "creada"; tareaId: string; threadId: string }
  | { tipo: "progreso"; tareaId: string; paso: number; total: number; mensaje: string }
  | { tipo: "fin"; tareaId: string; estado: EstadoTarea; resumen?: string }
  | { tipo: "error"; tareaId: string; error: string };
