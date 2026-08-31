/**
 * Tests del servidor HTTP del bridge: loopback (M2) y evicción del Map (M1).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { BridgeHttpServer } from "../src/http-server.js";
import type { BridgeConfig } from "../src/types.js";

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

async function arrancarServidor(port: number) {
  const s = new BridgeHttpServer(() => cfgBasica(), { puerto: port, host: "127.0.0.1" });
  const puertoReal = await s.listen();
  return { s, puertoReal };
}

test("M2: rechaza peticiones con Origin no-loopback (403)", async () => {
  const { s, puertoReal } = await arrancarServidor(0);
  try {
    const res = await fetch(`http://127.0.0.1:${puertoReal}/health`, {
      headers: { origin: "https://evil.example.com" },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /no loopback/i);
  } finally {
    await s.close();
  }
});

test("M2: acepta peticiones sin Origin (curl/CLI)", async () => {
  const { s, puertoReal } = await arrancarServidor(0);
  try {
    const res = await fetch(`http://127.0.0.1:${puertoReal}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok?: boolean };
    assert.equal(body.ok, true);
  } finally {
    await s.close();
  }
});

test("M1: POST /task sin tarea devuelve 400", async () => {
  const { s, puertoReal } = await arrancarServidor(0);
  try {
    const res = await fetch(`http://127.0.0.1:${puertoReal}/task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    await s.close();
  }
});
