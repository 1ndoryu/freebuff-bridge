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
function clientMock(opts?: { missionOn?: boolean }) {
  const messages: { role: string; text: string }[] = [{ role: "user", text: "tarea" }];
  return {
    openProject: async () => ({ ok: true }),
    crearHilo: async () => ({ id: "thread-1", model: "deepseek/deepseek-v4-flash" }),
    enviarMensaje: async (_id: string, text: string) => {
      messages.push({ role: "user", text });
      return { ok: true };
    },
    snapshot: async () => ({
      thread: { id: "thread-1", title: "t", turnState: "idle", missionOn: opts?.missionOn ?? false },
      messages: messages.map((m, i) => ({ id: String(i), role: m.role as "user", text: m.text })),
    }),
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
