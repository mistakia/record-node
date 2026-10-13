// Startup phase timings report only a run long enough to matter.

import { describe, expect, spyOn, test } from 'bun:test'

import { open_phases } from '#peer/open-phases.ts'

describe('open phases', () => {
  test('a run under a second stays silent; a longer one names each phase', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const quick = open_phases()
      expect(quick.time('restore', () => 7)).toBe(7)
      quick.report('library /a opened')
      expect(log).not.toHaveBeenCalled()

      const slow = open_phases()
      await slow.time_async('read_cache', async () => { await Bun.sleep(1050) })
      slow.report('library /b opened')
      expect(log).toHaveBeenCalledTimes(1)
      expect(String(log.mock.calls[0]?.[0])).toMatch(/^library \/b opened in 1\.\d s \(read_cache 1\.\d s\)$/)
    } finally {
      log.mockRestore()
    }
  })
})
