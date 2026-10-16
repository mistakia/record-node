import { type Authenticate } from './middleware.ts';
export interface AccessToken {
    readonly id: string;
    readonly label: string;
    readonly token_sha256: string;
    readonly created_at: string;
    readonly revoked_at: string | null;
}
export type AccessTokenSummary = Omit<AccessToken, 'token_sha256'>;
export declare const read_access_tokens: (path: string) => Promise<AccessToken[]>;
export declare const issue_access_token: ({ path, label, now }: {
    path: string;
    label: string;
    now?: Date;
}) => Promise<{
    token: string;
    entry: AccessTokenSummary;
}>;
export declare const list_access_tokens: (path: string) => Promise<AccessTokenSummary[]>;
export declare const revoke_access_token: ({ path, id, now }: {
    path: string;
    id: string;
    now?: Date;
}) => Promise<AccessTokenSummary>;
export interface TokenAuthenticator {
    authenticate: Authenticate;
    watch: (listener: () => void) => () => void;
}
export declare const create_token_authenticator: ({ path, poll_interval_ms }: {
    path: string;
    poll_interval_ms?: number;
}) => TokenAuthenticator;
