/**
 * Tests del orquestador (bridge) con un gestor mock y un client mock.
 *
 * No requiere Freebuff real: se prueba la máquina de estados y los límites.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { FreebuffBridge } from "../src/bridge.js";
import { GestorNinguno } from "../src/gestor/ninguno.js";
import type { BridgeConfig, Gestor, Plan } from "../src/types.js";

function cfgBasica(): BridgeConfig {
  return {
    freebuff: {
      baseUrl: "http://127.0.0.1:8788",
      projectPath: "C:/tmp/fb-bridge-test",
      model: "deepseek/deepseek-v4-flash",
      reasoningEffort: "high",
      harnessId: "codebuff",
    },
    gestor: { tipo: "ninguno" },
    limites: {
      timeoutPasoMin: 1,
      timeoutTotalMin: 2,
      watchdogInactividadMin: 1,
      maxRefinamientos: 2,
      maxLlamadasGestor: 10,
      pollIntervalMs: 50,
    },
  };
}

/** Gestor fake: plan de 1 paso, evalúa ok. */
function gestorOk(): Gestor {
  return {
    esAutonomo: () => false,
    async planificar(tarea: string): Promise<Plan> {
      return { pasos: [{ prompt: tarea, criterio: "ok", indice: 1 }] };
    },
    async evaluar(): Promise<{ tipo: "ok" }> {
      return { tipo: "ok" };
    },
  };
}

/** SSE mock: resuelve fin inmediatamente. */
function sseMock() {
  return {
    esperarFin: async () => ({ fin: true, ultimoEvento: null }),
  };
}

/** Client mock: simula la API local de Freebuff. */
function clientMock(opts?: { missionOn?: boolean; turnState?: "idle" | "running" }) {
  const messages: { role: string; text: string }[] = [{ role: "user", text: "tarea" }];
  const snap = () => ({
    thread: {
      id: "thread-1",
      title: "t",
      turnState: opts?.turnState ?? "idle",
      missionOn: opts?.missionOn ?? false,
    },
    messages: messages.map((m, i) => ({ id: String(i), role: m.role as "user", text: m.text })),
  });
  return {
    openProject: async () => ({ ok: true }),
    crearHilo: async () => ({ id: "thread-1", model: "deepseek/deepseek-v4-flash" }),
    enviarMensaje: async (_id: string, text: string) => {
      messages.push({ role: "user", text });
      return { ok: true };
    },
    snapshot: async () => snap(),
    mensajes: async () => snap().messages,
    snapshotNormalizado: async () => ({ snap: snap(), mensajes: snap().messages }),
    stop: async () => ({ ok: true }),
    setMissionOn: async () => ({ ok: true }),
    setMissionEffort: async () => ({ ok: true }),
    setMissionPrompt: async () => ({ ok: true }),
    missionReceipts: async () => [],
  };
}

test("runTask completa una tarea con gestor externo (1 paso, ok)", async () => {
  const cfg = cfgBasica();
  const b = new FreebuffBridge(cfg, gestorOk(), { client: clientMock() as never, sse: sseMock() as never });
  const r = await b.runTask("haz algo", {});
  assert.equal(r.estado, "completada");
  assert.equal(r.threadId, "thread-1");
  assert.ok(r.llamadasGestor >= 1); // planificar
});

test("runTask en modo autónomo (gestor ninguno) completa y lee receipts", async () => {
  const cfg = cfgBasica();
  const mock = clientMock({ missionOn: false });
  // Misión ya terminada en el primer snapshot → fin rápido.
  const b = new FreebuffBridge(cfg, new GestorNinguno(), { client: mock as never, sse: sseMock() as never });
  const r = await b.runTask("tarea autonoma", {});
  assert.equal(r.estado, "completada");
});

test("runTask detecta fallo de turno y devuelve fallida", async () => {
  const cfg = cfgBasica();
  const mock = clientMock();
  // Forzar que el envío falle.
  mock.enviarMensaje = async () => {
    throw new Error("Freebuff rechazó el mensaje");
  };
  const b = new FreebuffBridge(cfg, gestorOk(), { client: mock as never, sse: sseMock() as never });
  const r = await b.runTask("falla", {});
  assert.equal(r.estado, "fallida");
  assert.ok(r.error);
});

test("runTask corta por presupuesto de llamadas al gestor", async () => {
  const cfg = cfgBasica();
  let llamadas = 0;
  const gestor: Gestor = {
    esAutonomo: () => false,
    async planificar(tarea: string): Promise<Plan> {
      llamadas++;
      return { pasos: [{ prompt: tarea, criterio: "c", indice: 1 }] };
    },
    async evaluar(): Promise<{ tipo: "refinar"; prompt: string }> {
      llamadas++;
      return { tipo: "refinar", prompt: "reintenta" };
    },
  };
  cfg.limites.maxLlamadasGestor = 3;
  const b = new FreebuffBridge(cfg, gestor, { client: clientMock() as never, sse: sseMock() as never });
  const r = await b.runTask("bucle", {});
  assert.equal(r.estado, "fallida");
  assert.match(r.error ?? "", /presupuesto/i);
  assert.ok(llamadas >= 3);
});

test("runTask corta por refinamientos máximos", async () => {
  const cfg = cfgBasica();
  const gestor: Gestor = {
    esAutonomo: () => false,
    async planificar(tarea: string): Promise<Plan> {
      return { pasos: [{ prompt: tarea, criterio: "c", indice: 1 }] };
    },
    async evaluar(): Promise<{ tipo: "refinar"; prompt: string }> {
      return { tipo: "refinar", prompt: "refina" };
    },
  };
  cfg.limites.maxRefinamientos = 1;
  const b = new FreebuffBridge(cfg, gestor, { client: clientMock() as never, sse: sseMock() as never });
  const r = await b.runTask("refina mucho", {});
  assert.equal(r.estado, "fallida");
  assert.match(r.error ?? "", /refinamientos/i);
});

test("pasos vacíos del plan → fallida", async () => {
  const cfg = cfgBasica();
  const gestor: Gestor = {
    esAutonomo: () => false,
    async planificar(): Promise<Plan> {
      return { pasos: [] };
    },
    async evaluar(): Promise<{ tipo: "ok" }> {
      return { tipo: "ok" };
    },
  };
  const b = new FreebuffBridge(cfg, gestor, { client: clientMock() as never, sse: sseMock() as never });
  const r = await b.runTask("sin plan", {});
  assert.equal(r.estado, "fallida");
});

test("H4: signal externo cancela la tarea", async () => {
  const cfg = cfgBasica();
  const ctrl = new AbortController();
  // Gestor que tarda: la señal debe abortar el flujo.
  const gestor: Gestor = {
    esAutonomo: () => false,
    async planificar(): Promise<Plan> {
      await new Promise((r) => setTimeout(r, 50));
      return { pasos: [{ prompt: "p", criterio: "c", indice: 1 }] };
    },
    async evaluar(): Promise<{ tipo: "ok" }> {
      return { tipo: "ok" };
    },
  };
  const b = new FreebuffBridge(cfg, gestor, { client: clientMock() as never, sse: sseMock() as never });
  const p = b.runTask("cancelable", { signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 5);
  const r = await p;
  assert.equal(r.estado, "cancelada");
});

test("H5: stop por salida ilegible del gestor → fallida (no cancelada)", async () => {
  const cfg = cfgBasica();
  const gestor: Gestor = {
    esAutonomo: () => false,
    async planificar(tarea: string): Promise<Plan> {
      return { pasos: [{ prompt: tarea, criterio: "c", indice: 1 }] };
    },
    async evaluar(): Promise<{ tipo: "stop"; motivo: string }> {
      return { tipo: "stop", motivo: "evaluación ilegible: la salida del gestor no era JSON válido" };
    },
  };
  const b = new FreebuffBridge(cfg, gestor, { client: clientMock() as never, sse: sseMock() as never });
  const r = await b.runTask("haz algo", {});
  assert.equal(r.estado, "fallida");
  assert.match(r.error ?? "", /ilegible/i);
});

test("H5: stop por criterio del gestor → cancelada", async () => {
  const cfg = cfgBasica();
  const gestor: Gestor = {
    esAutonomo: () => false,
    async planificar(tarea: string): Promise<Plan> {
      return { pasos: [{ prompt: tarea, criterio: "c", indice: 1 }] };
    },
    async evaluar(): Promise<{ tipo: "stop"; motivo: string }> {
      return { tipo: "stop", motivo: "el gestor decidió no continuar" };
    },
  };
  const b = new FreebuffBridge(cfg, gestor, { client: clientMock() as never, sse: sseMock() as never });
  const r = await b.runTask("haz algo", {});
  assert.equal(r.estado, "cancelada");
});

test("H6: SSE cierra sin finish con turno running → fallida", async () => {
  const cfg = cfgBasica();
  // SSE devuelve fin:false (stream cerrado sin finish).
  const sse = { esperarFin: async () => ({ fin: false, ultimoEvento: null }) };
  // El snapshot dice que el turno sigue en curso.
  const b = new FreebuffBridge(cfg, gestorOk(), {
    client: clientMock({ turnState: "running" }) as never,
    sse: sse as never,
  });
  const r = await b.runTask("corte", {});
  assert.equal(r.estado, "fallida");
  assert.match(r.error ?? "", /sin señal de fin|cerró/i);
});

test("H2/H3: el bridge aborta el SSE al terminar la tarea (sin stream colgado)", async () => {
  const cfg = cfgBasica();
  let aborted = false;
  const sse = {
    esperarFin: async (_id: string, opts?: { signal?: AbortSignal }) => {
      opts?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise((resolve) => {
        // Nunca resuelve por sí solo: depende del abort o del fin por polling.
        opts?.signal?.addEventListener("abort", () => resolve({ fin: false, ultimoEvento: null }));
      });
    },
  };
  const b = new FreebuffBridge(cfg, new GestorNinguno(), { client: clientMock({ missionOn: false }) as never, sse: sse as never });
  const r = await b.runTask("autonomo abort", {});
  assert.equal(r.estado, "completada");
  assert.equal(aborted, true, "el SSE debe abortarse al terminar");
});
