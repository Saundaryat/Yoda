#!/usr/bin/env node
// MCP stdio server Hermes spawns for each run. State lives in CRM_STATE_FILE so it survives
// across Hermes processes and the runner can read it back after each turn.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadState, saveState } from './state.js';
import { callTool, TOOLS, type ToolName } from './tools.js';

const stateFile = process.env.CRM_STATE_FILE;
if (!stateFile) throw new Error('CRM_STATE_FILE is required');

const server = new McpServer({ name: 'crm', version: '1.0.0' });

for (const [name, tool] of Object.entries(TOOLS)) {
  server.registerTool(
    name,
    { description: tool.description, inputSchema: tool.input },
    async (args: Record<string, unknown>) => {
      const state = loadState(stateFile);
      const { ok, result } = callTool(state, name as ToolName, args);
      saveState(stateFile, state);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: !ok };
    },
  );
}

await server.connect(new StdioServerTransport());
