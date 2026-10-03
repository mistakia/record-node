export declare const LOCK_FILE_NAME = "lock";
export declare class DataDirectoryLocked extends Error {
    readonly code = "data_dir_locked";
    constructor(data_dir: string);
}
export interface DataDirectoryLock {
    release: () => void;
}
export declare const lock_data_dir: (data_dir: string) => DataDirectoryLock;
