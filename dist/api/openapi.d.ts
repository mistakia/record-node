import { Router, type RequestHandler } from 'express';
export declare const load_api_spec: () => Record<string, unknown>;
export declare const create_docs_router: (spec: Record<string, unknown>) => Router;
export declare const create_validator: ({ spec, validate_responses }: {
    spec: Record<string, unknown>;
    validate_responses: boolean;
}) => import("express-openapi-validator/dist/framework/types.js").OpenApiRequestHandler[];
export declare const parse_uploads: (upload_dir: string) => RequestHandler;
