/**
 * Tests del cliente de la API local de Freebuff con fetch mock.
 * Verifica las rutas y cuerpos enviados (endpoints reales del bundle).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { FreebuffClient } from "../src/client-freebuff.js";

function cfg() {
  return {
    baseUrl: "http://127.0.0.1:8788",
    projectPath: "C:/tmp/fb-bridge-test",
    model: "deepseek/deepseek-v4-flash",
    reasoningEffort: "high",
    harnessId: "codebuff",
  };
}

/** Stub directo de fetch que captura URL y body. */
function stubFetch(respuesta: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(respuesta), { status: 200 });
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("crearHilo hace POST /api/threads con el modelo y proyecto (thread directo)", async () => {
  const { calls, restore } = stubFetch({ ok: true, id: "t1", title: "t", model: "deepseek/deepseek-v4-flash" });
  try {
    const c = new FreebuffClient(cfg());
    const hilo = await c.crearHilo({ title: "t", model: "deepseek/deepseek-v4-flash", reasoningEffort: "high", harnessId: "codebuff" });
    assert.equal(hilo.id, "t1");
    assert.equal(calls[0].url, "http://127.0.0.1:8788/api/threads");
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.model, "deepseek/deepseek-v4-flash");
    assert.equal(body.projectPath, "C:/tmp/fb-bridge-test");
    assert.equal(body.harnessId, "codebuff");
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test("crearHilo acepta la forma envuelta { thread: {...} }", async () => {
  const { restore } = stubFetch({ ok: true, thread: { id: "t2", model: "m" } });
  try {
    const c = new FreebuffClient(cfg());
    const hilo = await c.crearHilo({ model: "m" });
    assert.equal(hilo.id, "t2");
  } finally {
    restore();
  }
});

test("enviarMensaje hace POST /api/thread/:id/message", async () => {
  const { calls, restore } = stubFetch({ ok: true, queued: false });
  try {
    const c = new FreebuffClient(cfg());
    const r = await c.enviarMensaje("t1", "hola");
    assert.deepEqual(r, { ok: true, queued: false });
    assert.equal(calls[0].url, "http://127.0.0.1:8788/api/thread/t1/message");
  } finally {
    restore();
  }
});

test("mission: activa, effort y prompt con los endpoints correctos", async () => {
  const { calls, restore } = stubFetch({ ok: true, thread: {} });
  try {
    const c = new FreebuffClient(cfg());
    await c.setMissionOn("t1", true);
    await c.setMissionEffort("t1", 3);
    await c.setMissionPrompt("t1", "haz algo");
    const urls = calls.map((x) => x.url);
    assert.ok(urls.includes("http://127.0.0.1:8788/api/thread/t1/mission"));
    assert.ok(urls.includes("http://127.0.0.1:8788/api/thread/t1/mission-effort"));
    assert.ok(urls.includes("http://127.0.0.1:8788/api/thread/t1/mission-prompt"));
  } finally {
    restore();
  }
});

test("snapshot devuelve los mensajes del hilo", async () => {
  const { restore } = stubFetch({
    thread: { id: "t1", turnState: "idle" },
    messages: [{ id: "1", role: "user", text: "a" }, { id: "2", role: "assistant", text: "b" }],
  });
  try {
    const c = new FreebuffClient(cfg());
    const msgs = await c.mensajes("t1");
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1].text, "b");
  } finally {
    restore();
  }
});

test("mensajes normaliza parts[] (kind text) del snapshot real", async () => {
  const { restore } = stubFetch({
    thread: { id: "t1", turnState: "idle" },
    messages: [
      { id: "1", role: "user", text: "hola" },
      {
        id: "2",
        role: "assistant",
        text: "",
        parts: [
          { kind: "reasoning", text: "pensando..." },
          { kind: "text", text: "VERDE" },
        ],
      },
    ],
  });
  try {
    const c = new FreebuffClient(cfg());
    const msgs = await c.mensajes("t1");
    assert.equal(msgs[1].text, "VERDE");
  } finally {
    restore();
  }
});

test("authStatus llama a /api/auth/status", async () => {
  const { calls, restore } = stubFetch({ authed: true });
  try {
    const c = new FreebuffClient(cfg());
    const st = await c.authStatus();
    assert.equal(st.authed, true);
    assert.equal(calls[0].url, "http://127.0.0.1:8788/api/auth/status");
  } finally {
    restore();
  }
});
