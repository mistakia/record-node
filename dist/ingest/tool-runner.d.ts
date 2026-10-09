import type { ToolRequest, ToolResponse } from './subprocess.ts';
export declare const run_tool_request: (request: ToolRequest, reply: (response: ToolResponse) => void) => void;
