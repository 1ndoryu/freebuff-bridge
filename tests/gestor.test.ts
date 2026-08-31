/**
 * Tests del port del gestor con mocks HTTP.
 * Verifica que GloryAPI parsea planes/evaluaciones JSON y que "ninguno" es autónomo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { GestorGloryAPI } from "../src/gestor/gloryapi.js";
import { GestorNinguno } from "../src/gestor/ninguno.js";

/**
 * Stub directo de globalThis.fetch que envuelve cada respuesta en la
 * estructura OpenAI-compatible que el gestor espera:
 * { choices: [{ message: { content } }] }
 * (node:test mock.fn no intercepta fetch; usamos un stub manual.)
 */
function stubFetch(respuestas: { status?: number; body: string }[]) {
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const r = respuestas[i++] ?? respuestas[respuestas.length - 1];
    const wrapped = JSON.stringify({ choices: [{ message: { content: r.body } }] });
    return new Response(wrapped, { status: r.status ?? 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("GestorGloryAPI.planificar parsea un plan JSON", async () => {
  const restore = stubFetch([{ body: JSON.stringify({ pasos: [{ prompt: "p1", criterio: "c1" }, { prompt: "p2", criterio: "c2" }] }) }]);
  try {
    const g = new GestorGloryAPI({ baseUrl: "http://x/v1/chat/completions", apiKey: "k", model: "m" });
    const plan = await g.planificar("tarea", { threadId: "t1", tarea: "t", projectPath: "p", messages: [] });
    assert.equal(plan.pasos.length, 2);
    assert.equal(plan.pasos[0].indice, 1);
    assert.equal(plan.pasos[1].prompt, "p2");
  } finally {
    restore();
  }
});

test("GestorGloryAPI.planificar cae a un solo paso si no es JSON", async () => {
  const restore = stubFetch([{ body: "haz X y listo" }]);
  try {
    const g = new GestorGloryAPI({ baseUrl: "http://x", apiKey: "k" });
    const plan = await g.planificar("t", { threadId: "t1", tarea: "t", projectPath: "p", messages: [] });
    assert.equal(plan.pasos.length, 1);
    assert.ok(plan.nota);
  } finally {
    restore();
  }
});

test("GestorGloryAPI.evaluar devuelve ok/refinar/stop", async () => {
  const g = new GestorGloryAPI({ baseUrl: "http://x", apiKey: "k" });
  const ctx = { threadId: "t1", tarea: "t", projectPath: "p", messages: [] };
  const paso = { prompt: "p", criterio: "c", indice: 1 };

  let restore = stubFetch([{ body: JSON.stringify({ tipo: "ok" }) }]);
  try {
    assert.deepEqual(await g.evaluar(paso, "r", ctx), { tipo: "ok" });
  } finally {
    restore();
  }

  restore = stubFetch([{ body: JSON.stringify({ tipo: "refinar", prompt: "corrige" }) }]);
  try {
    const d = await g.evaluar(paso, "r", ctx);
    assert.equal(d.tipo, "refinar");
    if (d.tipo === "refinar") assert.equal(d.prompt, "corrige");
  } finally {
    restore();
  }

  restore = stubFetch([{ body: JSON.stringify({ tipo: "stop", motivo: "no" }) }]);
  try {
    assert.deepEqual(await g.evaluar(paso, "r", ctx), { tipo: "stop", motivo: "no" });
  } finally {
    restore();
  }
});

test("GestorNinguno es autónomo: plan de 1 paso y evalúa ok", async () => {
  const g = new GestorNinguno();
  const plan = await g.planificar("hazlo", { threadId: "t", tarea: "hazlo", projectPath: "p", messages: [] });
  assert.equal(plan.pasos.length, 1);
  assert.equal(plan.pasos[0].prompt, "hazlo");
  const d = await g.evaluar(plan.pasos[0], "r", { threadId: "t", tarea: "h", projectPath: "p", messages: [] });
  assert.deepEqual(d, { tipo: "ok" });
});

test("esAutonomo() es método del port, no instanceof", () => {
  assert.equal(new GestorGloryAPI({ baseUrl: "http://x", apiKey: "k" }).esAutonomo(), false);
  assert.equal(new GestorNinguno().esAutonomo(), true);
});

test("GestorGloryAPI.evaluar con salida no-JSON NO aprueba en silencio (H5)", async () => {
  const g = new GestorGloryAPI({ baseUrl: "http://x", apiKey: "k" });
  const ctx = { threadId: "t1", tarea: "t", projectPath: "p", messages: [] };
  const paso = { prompt: "p", criterio: "c", indice: 1 };

  const restore = stubFetch([{ body: "esto no es JSON en absoluto" }]);
  try {
    const d = await g.evaluar(paso, "r", ctx);
    assert.equal(d.tipo, "stop");
    if (d.tipo === "stop") assert.match(d.motivo, /ilegible/i);
  } finally {
    restore();
  }
});

test("GestorGloryAPI.evaluar con JSON sin tipo reconocido NO aprueba en silencio (H5)", async () => {
  const g = new GestorGloryAPI({ baseUrl: "http://x", apiKey: "k" });
  const ctx = { threadId: "t1", tarea: "t", projectPath: "p", messages: [] };
  const paso = { prompt: "p", criterio: "c", indice: 1 };

  const restore = stubFetch([{ body: JSON.stringify({ tipo: "bailar" }) }]);
  try {
    const d = await g.evaluar(paso, "r", ctx);
    assert.equal(d.tipo, "stop");
  } finally {
    restore();
  }
});
