import { describe, expect, test } from 'bun:test'

import { with_resolver_tags } from '#ingest/metadata.ts'

const FINGERPRINT = { acoustid_fingerprint: 'AQAA' }

describe('with_resolver_tags', () => {
  test('splits an Artist - Title full title, ahead of the uploader in artist', () => {
    expect(with_resolver_tags(FINGERPRINT, [{ extractor: 'youtube', id: 'a', fulltitle: 'Overmono - So U Kno (Audio)', artist: 'Overmono' }]))
      .toEqual({ ...FINGERPRINT, title: 'So U Kno (Audio)', artist: 'Overmono' })
    expect(with_resolver_tags(FINGERPRINT, [{ extractor: 'youtube', id: 'b', fulltitle: 'Fake Blood – Mars (Original Mix)', artist: 'jaleckmichdochfett' }]))
      .toEqual({ ...FINGERPRINT, title: 'Mars (Original Mix)', artist: 'Fake Blood' })
  })

  test('takes alt_title as the title with the record artist', () => {
    expect(with_resolver_tags(FINGERPRINT, [{ extractor: 'youtube', id: 'c', fulltitle: 'Overmono - So U Kno', alt_title: 'So U Kno', artist: 'Overmono' }]))
      .toEqual({ ...FINGERPRINT, title: 'So U Kno', artist: 'Overmono' })
  })

  test('keeps a full title with no separator whole', () => {
    expect(with_resolver_tags(FINGERPRINT, [{ extractor: 'soundcloud', id: 'd', fulltitle: 'Late Night Mix', artist: 'someone' }]))
      .toEqual({ ...FINGERPRINT, title: 'Late Night Mix', artist: 'someone' })
    expect(with_resolver_tags(FINGERPRINT, [{ extractor: 'soundcloud', id: 'e', fulltitle: 'Up-Tempo' }]))
      .toEqual({ ...FINGERPRINT, title: 'Up-Tempo' })
  })

  test('never overrides the file tags, and is a no-op without a record', () => {
    const tagged = { ...FINGERPRINT, title: 'From File', artist: 'File Artist' }
    expect(with_resolver_tags(tagged, [{ extractor: 'youtube', id: 'f', fulltitle: 'A - B' }])).toEqual(tagged)
    expect(with_resolver_tags({ ...FINGERPRINT, title: 'From File' }, [{ extractor: 'youtube', id: 'g', fulltitle: 'A - B' }]))
      .toEqual({ ...FINGERPRINT, title: 'From File', artist: 'A' })
    expect(with_resolver_tags(FINGERPRINT, [])).toEqual(FINGERPRINT)
  })
})
