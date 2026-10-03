// Request middleware and the error envelope. Every non-2xx body is
// { error: { code, message, details? } } with a code from the spec's enum.

import type { ErrorRequestHandler, RequestHandler, Response } from 'express'

import { PeerError } from '#types/peer.ts'
import { ProtocolError } from '#types/errors.ts'

export type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_ERROR'

export interface ErrorDetail {
  field: string
  message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details: ErrorDetail[] | undefined

  constructor ({ status, code, message, details }: { status: number, code: ErrorCode, message: string, details?: ErrorDetail[] }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

// Verifies a bearer token. Absent in local-first mode, where every request
// is the node's own operator.
export type Authenticate = (token: string | undefined) => boolean | Promise<boolean>

// Whether a request's Origin may use the API: any origin when cors_origins is
// unset, otherwise only those listed. A request with no Origin is not from a
// browser page and always passes.
export const origin_allowed = (cors_origins: readonly string[] | undefined, origin: string | undefined): boolean =>
  origin === undefined || cors_origins === undefined || cors_origins.includes(origin)

// Echo an allowed Origin and allow credentials. A request from any other
// origin is refused outright, not just left without CORS headers: the headers
// only stop a page reading the response, and a simple request such as a
// multipart upload takes effect without a preflight.
export const cors = (cors_origins: readonly string[] | undefined): RequestHandler => (req, res, next) => {
  const origin = req.headers.origin
  if (!origin_allowed(cors_origins, origin)) {
    next(new ApiError({ status: 403, code: 'FORBIDDEN', message: `origin not allowed: ${String(origin)}` }))
    return
  }
  if (origin !== undefined) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
}

export const no_cache: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate')
  next()
}

export const bearer_token = (header: string | undefined): string | undefined => {
  const match = /^Bearer (.+)$/.exec(header ?? '')
  return match?.[1]
}

export const authenticate_requests = (authenticate: Authenticate | undefined): RequestHandler => async (req, _res, next) => {
  if (authenticate === undefined || await authenticate(bearer_token(req.headers.authorization))) {
    next()
    return
  }
  next(new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'a valid bearer token is required' }))
}

const send_error = (res: Response, { status, code, message, details }: {
  status: number
  code: ErrorCode
  message: string
  details?: ErrorDetail[] | undefined
}): void => {
  res.status(status).json({ error: details === undefined ? { code, message } : { code, message, details } })
}

const PEER_ERRORS = {
  not_found: { status: 404, code: 'NOT_FOUND' },
  conflict: { status: 409, code: 'CONFLICT' },
  forbidden: { status: 403, code: 'FORBIDDEN' },
  invalid: { status: 400, code: 'VALIDATION_ERROR' }
} as const

// express-openapi-validator errors carry an HTTP status and per-path errors.
interface ValidatorError {
  status: number
  message: string
  errors?: Array<{ path?: string, message?: string }>
}

const is_validator_error = (error: unknown): error is ValidatorError =>
  error instanceof Error && typeof (error as Partial<ValidatorError>).status === 'number'

const validator_code = (status: number): ErrorCode => {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 404 || status === 405) return 'NOT_FOUND'
  if (status >= 500) return 'INTERNAL_ERROR'
  return 'VALIDATION_ERROR'
}

export const handle_errors = (log_error: (error: unknown) => void): ErrorRequestHandler => (error: unknown, _req, res, _next) => {
  if (error instanceof ApiError) {
    send_error(res, error)
  } else if (error instanceof PeerError) {
    send_error(res, { ...PEER_ERRORS[error.code], message: error.message })
  } else if (error instanceof ProtocolError) {
    send_error(res, { status: 400, code: 'VALIDATION_ERROR', message: error.message, details: [{ field: error.code, message: error.message }] })
  } else if (is_validator_error(error)) {
    if (error.status >= 500) log_error(error)
    const details = (error.errors ?? []).map(({ path, message }) => ({ field: path ?? '', message: message ?? '' }))
    send_error(res, { status: error.status, code: validator_code(error.status), message: error.message, details })
  } else {
    log_error(error)
    send_error(res, { status: 500, code: 'INTERNAL_ERROR', message: 'internal error' })
  }
}
