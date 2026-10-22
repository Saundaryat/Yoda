import { fileURLToPath } from 'node:url';

export {
  BUSINESS,
  CLINIC_TIMEZONE,
  clinicTime,
  loadState,
  materialize,
  saveState,
} from './state.js';
export { callTool, CrmError, TOOLS, type ToolName } from './tools.js';

/** Absolute path of the compiled MCP server, for Hermes's `mcp_servers` config. */
export const CRM_SERVER_PATH = fileURLToPath(new URL('./server.js', import.meta.url));
