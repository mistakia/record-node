// Fingerprinting, tag stripping, metadata, ingest, and listens (§6).
// Pending stubs, one per normative requirement, named by spec section. Each
// later stage turns its stubs into passing tests.

import { describe, test } from 'bun:test'

describe('content-processing', () => {
  test.todo('§6.1.1 [MUST] fingerprints come from Chromaprint', () => {})
  test.todo('§6.1.2 [MUST] Chromaprint algorithm 2 is used', () => {})
  test.todo('§6.1.2 [MUST] no fingerprint-affecting parameter is overridden; only the binary path is configurable', () => {})
  test.todo('§6.1.2 [MUST] algorithm 2 is requested explicitly, whatever the tool default', () => {})
  test.todo('§6.1.2.1 [MUST] the fingerprint is identical regardless of tags, artwork, or container framing', () => {})
  test.todo('§6.1.2.1 [MUST] files with the same samples and different tags yield the same fingerprint and track id', () => {})
  test.todo('§6.1.2.1 [MUST] tag-stripped audio is never fed to the fingerprinter', () => {})
  test.todo('§6.1.3 [MUST] the fingerprint is the fpcalc string output', () => {})
  test.todo('§6.1.5 [MUST] sha256(fpcalc(tagged)) equals sha256(fpcalc(strip_tags(tagged)))', () => {})
  test.todo('§6.2.1 [MUST] the tag-stripped copy is what gets uploaded', () => {})
  test.todo('§6.2.1 [MUST] tag stripping is deterministic, lossless, and byte-preserving', () => {})
  test.todo('§6.2.2 [MUST] tag stripping copies audio streams only', () => {})
  test.todo('§6.2.2 [MUST] tag stripping preserves audio bytes exactly', () => {})
  test.todo('§6.2.2 [MUST] tag stripping removes all metadata', () => {})
  test.todo('§6.2.2 [MUST] tag stripping suppresses the encoder-version tag', () => {})
  test.todo('§6.3.1 [MUST] content.tags carries acoustid_fingerprint', () => {})
  test.todo('§6.3.2 [MUST] missing format fields are omitted or null, never coerced to 0', () => {})
  test.todo('§6.3.3 [MUST] each artwork element is a CID', () => {})
  test.todo('§6.3.3 [MUST] a file with no artwork yields an empty artwork array', () => {})
  test.todo('§6.3.4 [MUST] artwork is not embedded in the tag-stripped audio', () => {})
  test.todo('§6.4.1 [MUST] ingest is rejected on an empty fingerprint, fingerprinter error, or no decodable audio', () => {})
  test.todo('§6.4.1 [MUST] sha256("") is never used as a fallback track id', () => {})
  test.todo('§6.4.1 [MUST] ingest is rejected when duration is 0 or unknown or the decoded sample count is zero', () => {})
  test.todo('§6.4.2 [MUST] the resolver url field is stripped before persistence', () => {})
  test.todo('§6.4.3 [MUST] CID ingest validates the §2.4.1 required fields before accepting', () => {})
  test.todo('§6.5 [MUST] a listen write without trackId is rejected', () => {})
  test.todo('§6.5 [MUST] listen entries cannot be deleted', () => {})
})
