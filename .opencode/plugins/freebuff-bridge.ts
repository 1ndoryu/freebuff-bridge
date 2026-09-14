/**
 * Re-export del plugin canonico (<area-trabajo>/.opencode/plugins/).
 * Este archivo solo existe para que el plugin cargue tambien cuando el
 * cwd de opencode es freebuff-bridge; la implementacion vive en un solo
 * lugar y no diverge.
 */
export { FreebuffBridgePlugin } from "../../../.opencode/plugins/freebuff-bridge.js";
