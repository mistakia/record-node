import type { NetworkCensusRow as CensusRow } from '#types/peer.ts';
export interface CensusObservations {
    on_connection_open: (listener: (peer_id: string) => void) => () => void;
    on_peer_identify: (listener: (peer_id: string, agent: string | undefined) => void) => () => void;
    on_library_announced: (listener: (library_address: string) => void) => () => void;
    connected_peer_count: () => number;
    count_rendezvous_addresses: () => Promise<number | null>;
}
export interface CensusTimers {
    now: () => number;
    set_interval: (job: () => void, interval_ms: number) => unknown;
    clear_interval: (handle: unknown) => void;
}
export declare const SYSTEM_CENSUS_TIMERS: CensusTimers;
export interface Census {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    read_row: (date?: string) => Promise<CensusRow | undefined>;
    tick: () => Promise<void>;
}
export declare const SAMPLE_INTERVAL_MS: number;
export declare const RETENTION_DAYS = 90;
export declare const VERSION_BUCKET_FLOOR = 3;
export declare const utc_date: (ms: number) => string;
export declare const week_start: (ms: number) => string;
export declare const parse_agent: (agent: string | undefined) => {
    version: string;
    mode: string | undefined;
};
export declare const create_census: ({ dir, observations, timers }: {
    dir: string;
    observations: CensusObservations;
    timers?: CensusTimers;
}) => Census;
