export interface Timers {
    now: () => number;
    set_timeout: (job: () => void, delay_ms: number) => unknown;
    clear_timeout: (handle: unknown) => void;
}
export declare const SYSTEM_TIMERS: Timers;
