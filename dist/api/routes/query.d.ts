import type { Request } from 'express';
export declare const query_value: <T>(req: Request, name: string) => T | undefined;
export declare const query_list: (req: Request, name: string) => string[] | undefined;
export declare const page: (req: Request) => {
    offset: number;
    limit: number;
};
