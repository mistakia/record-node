import type { AboutRecord, LabelPair, LabelsRecord } from '#types/entry.ts';
export declare const ABOUT_KEY: string;
export declare const ABOUT_NAME_MAX_BYTES = 128;
export declare const label_state_key: ([track_id, label]: LabelPair) => string;
export declare const is_label_key: (key: string) => boolean;
export declare const label_pair_of: (key: string) => LabelPair;
export declare const applies_label: (record: LabelsRecord, key: string) => boolean;
export declare const validate_labels_record: ({ key, value }: {
    key: string;
    value: unknown;
}) => LabelsRecord;
export declare const validate_about_record: ({ key, value }: {
    key: string;
    value: unknown;
}) => AboutRecord;
export declare const build_labels_record: ({ set, unset, timestamp }: {
    set?: readonly LabelPair[];
    unset?: readonly LabelPair[];
    timestamp?: number;
}) => LabelsRecord;
export declare const build_about_record: ({ name, timestamp }: {
    name: string;
    timestamp?: number;
}) => AboutRecord;
