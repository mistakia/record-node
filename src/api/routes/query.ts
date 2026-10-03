// Query values after request validation, which has already coerced them to
// the spec's types and applied its defaults.

import type { Request } from 'express'

export const query_value = <T>(req: Request, name: string): T | undefined =>
  (req.query as Record<string, unknown>)[name] as T | undefined

// An exploded array parameter arrives as a bare string when given once.
export const query_list = (req: Request, name: string): string[] | undefined => {
  const value = query_value<string | string[]>(req, name)
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

export const page = (req: Request): { offset: number, limit: number } => ({
  offset: query_value<number>(req, 'offset') ?? 0,
  limit: query_value<number>(req, 'limit') ?? 100
})
