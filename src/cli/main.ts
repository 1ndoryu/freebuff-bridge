#!/usr/bin/env node
/**
 * CLI del puente freebuff-bridge.
 *
 *   freebuff-bridge run "tarea" [--config config.json] [--no-gestor]
 *   freebuff-bridge server [--config config.json] [--port 4200]
 *   freebuff-bridge status [--config config.json]
 */

import { parseArgs } from "node:util";
import { cargarConfig, crearGestor, FreebuffBridge } from "../index.js";
import { log, logError } from "../logger.js";
import { BridgeHttpServer } from "../http-server.js";

function ayuda(): void {
  log("", `freebuff-bridge — puente agnóstico entre tu app y Freebuff local

USO:
  freebuff-bridge run "tarea" [--config config.json] [--autonomo]
  freebuff-bridge server [--config config.json] [--port 4200]
  freebuff-bridge status [--config config.json]

OPCIONES:
  --config <ruta>   Configuración (por defecto: ./config.json)
  --autonomo        Usa el modo Misión nativo de Freebuff (gestor "ninguno")
  --port <n>        Puerto del servidor HTTP (por defecto: config.http.puerto)
  --help            Esta ayuda

EJEMPLOS:
  freebuff-bridge run "crea un README en el proyecto" --autonomo
  freebuff-bridge server --port 4200
`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      config: { type: "string" },
      autonomo: { type: "boolean", default: false },
      port: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    ayuda();
    return;
  }

  const cmd = positionals[0];
  if (!cmd) {
    ayuda();
    process.exitCode = 1;
    return;
  }

  const rutaConfig = values.config ?? "./config.json";
  let cfg = cargarConfig(rutaConfig);
  if (values.autonomo) cfg = { ...cfg, gestor: { ...cfg.gestor, tipo: "ninguno" } };

  switch (cmd) {
    case "run": {
      const tarea = positionals[1];
      if (!tarea) {
        logError("", 'Uso: freebuff-bridge run "tarea" [--config config.json]');
        process.exitCode = 1;
        return;
      }
      const gestor = crearGestor(cfg.gestor);
      const bridge = new FreebuffBridge(cfg, gestor);
      log("", `[freebuff-bridge] Lanzando tarea (gestor: ${cfg.gestor.tipo})...`);
      const r = await bridge.runTask(tarea, {
        onEvento: (e) => {
          if (e.tipo === "progreso") log("", `  [${e.tipo}] paso ${e.paso}/${e.total}: ${e.mensaje}`);
          else if (e.tipo === "creada") log("", `  [creada] thread ${e.threadId}`);
          else if (e.tipo === "fin") log("", `  [fin] estado=${e.estado}`);
          else if (e.tipo === "error") logError("", `  [error] ${e.error}`);
        },
      });
      log("", "\n=== RESULTADO ===");
      log("", JSON.stringify(r, null, 2));
      process.exitCode = r.estado === "completada" ? 0 : 1;
      return;
    }
    case "server": {
      const port = values.port ? parseInt(values.port, 10) : (cfg.http?.puerto ?? 4200);
      const srv = new BridgeHttpServer(() => cfg, { puerto: port, host: cfg.http?.host ?? "127.0.0.1" });
      const puertoReal = await srv.listen();
      log("", `[freebuff-bridge] Servidor HTTP escuchando en http://127.0.0.1:${puertoReal}`);
      log("", "  POST /task            → lanza una tarea");
      log("", "  GET  /task/:id        → estado/resultado");
      log("", "  GET  /task/:id/events → eventos SSE");
      log("", "  GET  /health          → ok");
      // Mantener el proceso vivo.
      await new Promise<void>(() => {});
      return;
    }
    case "status": {
      const { FreebuffClient } = await import("../client-freebuff.js");
      const client = new FreebuffClient(cfg.freebuff);
      try {
        const st = await client.authStatus();
        log("", `[freebuff-bridge] Freebuff en ${cfg.freebuff.baseUrl}: ${st.authed ? "autenticado" : "NO autenticado"}`);
      } catch (e) {
        logError("", `[freebuff-bridge] No se pudo contactar con Freebuff: ${(e as Error).message}`);
        process.exitCode = 1;
      }
      return;
    }
    default:
      logError("", `Comando desconocido: ${cmd}`);
      ayuda();
      process.exitCode = 1;
  }
}

main().catch((e) => {
  logError("", `[freebuff-bridge] Error: ${(e as Error).message}`);
  process.exitCode = 1;
});