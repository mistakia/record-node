// The §6.4.2 step 3 download: stream a resolved audio URL to a file.

import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'

import { IngestError } from '#types/ingest.ts'

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

export type Download = (input: {
  url: string
  headers?: Readonly<Record<string, string>> | undefined
  output_path: string
}) => Promise<void>

export const download_to_file: Download = async ({ url, headers = {}, output_path }) => {
  let response: Response
  try {
    response = await fetch(url, { headers: { ...headers }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch (error) {
    throw new IngestError('download_failed', `download of the resolved audio failed: ${(error as Error).message}`)
  }
  if (!response.ok || response.body === null) {
    throw new IngestError('download_failed', `download of the resolved audio answered ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), createWriteStream(output_path))
}
