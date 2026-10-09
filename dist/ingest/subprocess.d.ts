export interface ToolOutput {
    readonly exit_code: number;
    readonly stdout: string;
    readonly stderr: string;
}
export interface ToolRequest {
    readonly id: number;
    readonly command: string;
    readonly args: readonly string[];
    readonly count_stdout: boolean;
}
type ToolResult = ToolOutput & {
    readonly stdout_bytes?: number;
};
export type ToolResponse = {
    readonly id: number;
    readonly start_error: string;
} | ToolResult & {
    readonly id: number;
};
export declare const TOOLS_IN_PROCESS: boolean;
export declare const run_tool: ({ command, args }: {
    command: string;
    args: readonly string[];
}) => Promise<ToolOutput>;
export declare const run_tool_counting: ({ command, args }: {
    command: string;
    args: readonly string[];
}) => Promise<{
    exit_code: number;
    stdout_bytes: number;
    stderr: string;
}>;
export {};
