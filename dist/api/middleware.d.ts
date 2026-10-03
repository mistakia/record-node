import type { ErrorRequestHandler, RequestHandler } from 'express';
export type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_ERROR';
export interface ErrorDetail {
    field: string;
    message: string;
}
export declare class ApiError extends Error {
    readonly status: number;
    readonly code: ErrorCode;
    readonly details: ErrorDetail[] | undefined;
    constructor({ status, code, message, details }: {
        status: number;
        code: ErrorCode;
        message: string;
        details?: ErrorDetail[];
    });
}
export type Authenticate = (token: string | undefined) => boolean | Promise<boolean>;
export declare const cors: (cors_origins: readonly string[] | undefined) => RequestHandler;
export declare const no_cache: RequestHandler;
export declare const bearer_token: (header: string | undefined) => string | undefined;
export declare const authenticate_requests: (authenticate: Authenticate | undefined) => RequestHandler;
export declare const handle_errors: (log_error: (error: unknown) => void) => ErrorRequestHandler;
