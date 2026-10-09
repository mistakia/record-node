// Audio re-derivation (§6.4.4): the decoded fields of §6.3.2 recomputed from
// the audio blob an entry already names. Tag stripping kept the audio bytes
// exactly (§6.2.2), so the blob decodes to the source's samples. ffmpeg reads
// the container from the bytes, so the temporary file needs no extension.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decode_audio, decoded_fields, type DecodedFields } from './duration.ts'
import type { Toolchain } from './toolchain.ts'

export const blob_decoded_fields = async ({ blob, size, toolchain }: {
  blob: Uint8Array
  size: number
  toolchain: Toolchain
}): Promise<DecodedFields> => {
  const temp_dir = await mkdtemp(join(tmpdir(), 'record-rederive-'))
  try {
    const file_path = join(temp_dir, 'audio')
    await writeFile(file_path, blob)
    return decoded_fields(await decode_audio({ file_path, toolchain }), size)
  } finally {
    await rm(temp_dir, { recursive: true, force: true })
  }
}

// The content with the decoded fields applied, or undefined when it already
// holds them and nothing should be appended.
export const with_decoded_fields = (content: Readonly<Record<string, unknown>>, fields: DecodedFields): Record<string, unknown> | undefined => {
  const audio = content.audio as Readonly<Record<string, unknown>>
  if (Object.entries(fields).every(([name, value]) => audio[name] === value)) return undefined
  return { ...content, audio: { ...audio, ...fields } }
}
