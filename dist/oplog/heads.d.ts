export declare const compute_heads: (entries: Iterable<{
    readonly hash: string;
    readonly entry: {
        readonly next: readonly string[];
    };
}>) => Set<string>;
