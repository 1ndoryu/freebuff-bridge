/*
 * [console-production] Logger centralizado de freebuff-bridge (boundary
 * declarado en sentinel.config.json › portableBoundaries.loggerModules).
 *
 * Toda llamada a console.* del puente pasa por estos accesores. error/warn
 * conservan su canal nativo (stderr) que ya llega al usuario por la salida del
 * CLI; log es la salida del CLI (esta utilidad ES un CLI: su stdout es el
 * producto); debug se silencia salvo `FREEBUFF_DEBUG=1`.
 * Es la única excepción documentada de la regla. El prefijo `[ambito]` estable
 * permite filtrar en consola por módulo; con `ambito` vacío (cadenas que ya
 * incrustan `[freebuff-bridge]` o bloques decorativos) la salida queda intacta.
 */
export function logError(ambito: string, ...args: unknown[]): void {
  if (ambito) console.error(`[${ambito}]`, ...args);
  else console.error(...args);
}

export function logWarn(ambito: string, ...args: unknown[]): void {
  if (ambito) console.warn(`[${ambito}]`, ...args);
  else console.warn(...args);
}

export function log(ambito: string, ...args: unknown[]): void {
  if (ambito) console.log(`[${ambito}]`, ...args);
  else console.log(...args);
}

export function debug(ambito: string, ...args: unknown[]): void {
  if (process.env.FREEBUFF_DEBUG) {
    if (ambito) console.debug(`[${ambito}]`, ...args);
    else console.debug(...args);
  }
}