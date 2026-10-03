export declare const run_bounded: <T>(items: Iterable<T>, limit: number, job: (item: T) => Promise<void>) => Promise<void>;
