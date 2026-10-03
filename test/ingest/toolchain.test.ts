// Toolchain preflight: pinned versions pass, anything else is refused.

import { describe, expect, test } from 'bun:test'

import { verify_toolchain } from '#ingest/toolchain.ts'
import { IngestError } from '#types/ingest.ts'
import { fake_tool, scratch_dir } from '#test/helpers/ingest.ts'

const dir = scratch_dir()
const pinned_ffmpeg = fake_tool({ dir, name: 'ffmpeg-pinned', version_line: 'ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers' })
const distro_ffmpeg = fake_tool({ dir, name: 'ffmpeg-distro', version_line: 'ffmpeg version 7.1.1-1ubuntu1 Copyright (c) 2000-2025' })
const newer_ffmpeg = fake_tool({ dir, name: 'ffmpeg-newer', version_line: 'ffmpeg version 8.1.2 Copyright (c) 2000-2026' })
const patch_ffmpeg = fake_tool({ dir, name: 'ffmpeg-patch', version_line: 'ffmpeg version 7.1.10 Copyright (c) 2000-2026' })
const pinned_fpcalc = fake_tool({ dir, name: 'fpcalc-pinned', version_line: 'fpcalc version 1.5.1' })
const newer_fpcalc = fake_tool({ dir, name: 'fpcalc-newer', version_line: 'fpcalc version 1.6.1 (FFmpeg Lavc62.28.102)' })
const silent = fake_tool({ dir, name: 'silent', version_line: '' })

const refusal = async (input: Parameters<typeof verify_toolchain>[0]) => {
  try {
    await verify_toolchain(input)
  } catch (error) {
    expect(error).toBeInstanceOf(IngestError)
    return error as IngestError
  }
  throw new Error('expected the toolchain to be refused')
}

describe('verify_toolchain', () => {
  test('accepts the pinned versions, distro suffix included', async () => {
    for (const ffmpeg_path of [pinned_ffmpeg, distro_ffmpeg]) {
      const toolchain = await verify_toolchain({ ffmpeg_path, fpcalc_path: pinned_fpcalc })
      expect(toolchain).toMatchObject({ ffmpeg_path, fpcalc_path: pinned_fpcalc, fpcalc_version: '1.5.1' })
    }
  })

  test('refuses an unpinned version and names both found and pinned', async () => {
    const error = await refusal({ ffmpeg_path: newer_ffmpeg, fpcalc_path: newer_fpcalc })
    expect(error.code).toBe('toolchain_mismatch')
    expect(error.message).toContain('ffmpeg 8.1.2 (pinned 7.1.1)')
    expect(error.message).toContain('fpcalc 1.6.1 (pinned 1.5.1)')
    expect((await refusal({ ffmpeg_path: patch_ffmpeg, fpcalc_path: pinned_fpcalc })).code).toBe('toolchain_mismatch')
  })

  test('the bypass tolerates a mismatch but still needs runnable tools', async () => {
    const toolchain = await verify_toolchain({ ffmpeg_path: newer_ffmpeg, fpcalc_path: newer_fpcalc, allow_version_mismatch: true })
    expect(toolchain.ffmpeg_version).toBe('8.1.2')
    expect((await refusal({ ffmpeg_path: silent, fpcalc_path: pinned_fpcalc, allow_version_mismatch: true })).code).toBe('toolchain_unavailable')
    expect((await refusal({ ffmpeg_path: `${dir}/absent`, fpcalc_path: pinned_fpcalc, allow_version_mismatch: true })).code).toBe('toolchain_unavailable')
  })
})
