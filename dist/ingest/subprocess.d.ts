export interface ToolOutput {
    readonly exit_code: number;
    readonly stdout: string;
    readonly stderr: string;
}
export declare const run_tool: ({ command, args }: {
    command: string;
    args: readonly string[];
}) => Promise<ToolOutput>;
