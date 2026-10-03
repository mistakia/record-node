export declare const next_clock_time: ({ local_time, head_times }: {
    local_time: number;
    head_times: Iterable<number>;
}) => number;
export declare const merge_clock_time: ({ local_time, remote_times }: {
    local_time: number;
    remote_times: Iterable<number>;
}) => number;
