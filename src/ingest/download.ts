// The §6.4.2 step 3 download: stream a resolved audio URL to a file.
//
// The URL comes from yt-dlp, so it is untrusted: every hop, the first and
// each redirect, must reach a public address. Redirects are followed by hand
// so each hop is checked, and a named host connects through record-resolver's
// guarded_lookup, so the address checked is the address connected to.

import { createWriteStream } from 'node:fs'
import { request as http_request, type IncomingMessage } from 'node:http'
import { request as https_request } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { pipeline } from 'node:stream/promises'
import { address_class, guarded_lookup } from 'record-resolver'

import { IngestError } from '#types/ingest.ts'

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const MAX_REDIRECTS = 10
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
// Credentials yt-dlp gathered for one origin are not sent to another.
const ORIGIN_BOUND_HEADERS = new Set(['authorization', 'cookie'])

export type Download = (input: {
  url: string
  headers?: Readonly<Record<string, string>> | undefined
  output_path: string
}) => Promise<void>

const failed = (message: string): IngestError => new IngestError('download_failed', `download of the resolved audio ${message}`)

const get = async ({ url, headers, lookup, signal }: {
  url: URL
  headers: Readonly<Record<string, string>>
  lookup: LookupFunction
  signal: AbortSignal
}): Promise<IncomingMessage> => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw failed(`was redirected to a non-http(s) url: ${url.href}`)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const literal_class = isIP(host) === 0 ? undefined : address_class(host)
  if (literal_class !== undefined) throw failed(`was refused: ${host} is a ${literal_class} address`)
  const request = url.protocol === 'https:' ? https_request : http_request
  return await new Promise((resolve, reject) => {
    const req = request(url, { headers: { ...headers }, lookup, signal }, resolve)
    req.on('error', (error) => {
      reject(failed((error as { code?: string }).code === 'BLOCKED_DESTINATION' ? `was refused: ${error.message}` : `failed: ${error.message}`))
    })
    req.end()
  })
}

// lookup is a seam for tests, which serve from loopback under a public name.
export const create_download = ({ lookup = guarded_lookup }: { lookup?: LookupFunction } = {}): Download => async ({ url, headers = {}, output_path }) => {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  let current: URL
  try {
    current = new URL(url)
  } catch {
    throw failed(`has an invalid url: ${url}`)
  }
  let hop_headers = headers
  for (let hops = 0; ; hops++) {
    const response = await get({ url: current, headers: hop_headers, lookup, signal })
    const status = response.statusCode ?? 0
    if (REDIRECT_STATUSES.has(status) && response.headers.location !== undefined) {
      response.resume()
      if (hops === MAX_REDIRECTS) throw failed(`redirected more than ${MAX_REDIRECTS} times`)
      const next = new URL(response.headers.location, current)
      if (next.origin !== current.origin) {
        hop_headers = Object.fromEntries(Object.entries(hop_headers).filter(([name]) => !ORIGIN_BOUND_HEADERS.has(name.toLowerCase())))
      }
      current = next
      continue
    }
    if (status < 200 || status > 299) {
      response.resume()
      throw failed(`answered ${status}`)
    }
    try {
      await pipeline(response, createWriteStream(output_path))
    } catch (error) {
      throw failed(`broke off: ${(error as Error).message}`)
    }
    return
  }
}

export const download_to_file: Download = create_download()
