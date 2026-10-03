// URL ingest fixtures: record-resolver's fake yt-dlp replaying its recorded
// fixtures, and a download that writes a tone in the container the resolved
// entry names. Nothing reaches the network.

import { fileURLToPath } from 'node:url'
import { resolve_url } from 'record-resolver'

import type { Download } from '#ingest/download.ts'
import { run_tool } from '#ingest/subprocess.ts'
import type { ResolveUrl } from '#peer/resolver.ts'
import { toolchain } from './ingest.ts'

export const FAKE_YTDLP = fileURLToPath(new URL('../../node_modules/record-resolver/test/fixtures/fake-yt-dlp.mjs', import.meta.url))

// The recorded youtube video: one m4a entry with a placeholder stream URL.
export const YOUTUBE_URL = 'https://www.youtube.com/watch?v=iODdvJGpfIA'
export const YOUTUBE_FIXTURE = 'youtube-video'
// The fixture's placeholder streaming url, which must never be persisted.
export const YOUTUBE_STREAM_URL = 'https://media.invalid/youtube/iODdvJGpfIA.m4a'

// Resolves through the real record-resolver against the fake yt-dlp, which
// replays the named fixture whatever the URL. Every host resolves to one
// public address, so the destination check needs no DNS.
export const fixture_resolver = (fixture: string): ResolveUrl => async (url) => {
  const saved = process.env.FAKE_YTDLP_FIXTURE
  process.env.FAKE_YTDLP_FIXTURE = fixture
  try {
    return await resolve_url(url, { binary_path: FAKE_YTDLP, lookup: async () => [{ address: '93.184.215.14', family: 4 }] })
  } finally {
    if (saved === undefined) Reflect.deleteProperty(process.env, 'FAKE_YTDLP_FIXTURE')
    else process.env.FAKE_YTDLP_FIXTURE = saved
  }
}

// Writes a 5 s tone to output_path, encoded for the extension the pipeline
// chose from the entry's ext. The tone is not the F7 sweep, so it ingests as
// its own track.
export const fixture_download = (): Download & { urls: string[] } => {
  const urls: string[] = []
  const download = async ({ url, output_path }: Parameters<Download>[0]) => {
    urls.push(url)
    const { exit_code, stderr } = await run_tool({
      command: toolchain.ffmpeg_path,
      args: ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=5:sample_rate=44100', output_path]
    })
    if (exit_code !== 0) throw new Error(`fixture download failed: ${stderr}`)
  }
  return Object.assign(download, { urls })
}
