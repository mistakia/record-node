export interface OpenPhases {
    time: <T>(phase: string, fn: () => T) => T;
    time_async: <T>(phase: string, fn: () => Promise<T>) => Promise<T>;
    report: (subject: string) => void;
}
export declare const open_phases: () => OpenPhases;
