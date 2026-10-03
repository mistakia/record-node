// The contract: record-docs spec/7-http-api.yaml, vendored byte-identical
// beside this file (record-docs v1.0.5, fe70f1d). It is served as the docs and
// validates every request, and responses too when asked (the tests ask).
// No schema is restated in code; a contract change lands in record-docs first.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import multer from 'multer';
import swagger_ui from 'swagger-ui-express';
import { parse } from 'yaml';
import { ApiError } from "./middleware.js";
const SPEC_PATH = new URL('./7-http-api.yaml', import.meta.url);
export const load_api_spec = () => parse(readFileSync(SPEC_PATH, 'utf8'));
// /api/docs (swagger-ui) and /api/docs/openapi.json.
export const create_docs_router = (spec) => {
    const router = Router();
    router.get('/openapi.json', (_req, res) => { res.json(spec); });
    router.use('/', swagger_ui.serve, swagger_ui.setup(spec));
    return router;
};
export const create_validator = ({ spec, validate_responses }) => OpenApiValidator.middleware({
    // The validator mutates the document it is given while resolving refs.
    apiSpec: structuredClone(spec),
    validateRequests: true,
    validateResponses: validate_responses,
    ignorePaths: /^\/api\/(docs|ws)(\/|$)/,
    // Its built-in uploader puts a lone file in the body as a string, not a
    // one-element array, so a single-file upload fails the spec's `files:
    // array`. Uploads are parsed by parse_uploads instead.
    fileUploader: false
});
// Buffer the multipart `files` parts to upload_dir under fresh names that
// keep the original extension, so the ingest tools can tell the container,
// and present them to the validator as the array the spec declares.
export const parse_uploads = (upload_dir) => {
    const upload = multer({
        storage: multer.diskStorage({
            destination: upload_dir,
            filename: (_req, file, done) => { done(null, `${randomUUID()}${extname(file.originalname)}`); }
        })
    }).array('files');
    return (req, res, next) => {
        upload(req, res, (error) => {
            if (error !== undefined) {
                next(error instanceof multer.MulterError
                    ? new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: error.message, details: [{ field: error.field ?? 'files', message: error.code }] })
                    : error);
                return;
            }
            const files = (req.files ?? []);
            req.body = { ...req.body, ...(files.length > 0 ? { files: files.map(() => '') } : {}) };
            next();
        });
    };
};
