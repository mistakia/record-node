// Library address /record/<manifest-cid>/<name> (§3.6), its derivation from
// (key, type, discriminator) (§3.6.1, §3.6.2), and the name charset (§3.7).
// Addresses are opaque strings for transport and comparison; parsing exists
// only to reach the manifest CID and name during AC chain resolution. Loading
// accepts any CID in the manifest slot (§3.7); creation always writes a §2.1 one.

import { ProtocolError } from '#types/errors.ts'
import type { LibraryType } from '#types/library.ts'
import { encode_canonical, type CanonicalBytes } from './canonical-bytes.ts'
import { compute_cid_string, is_cid_string } from './cid.ts'

const ADDRESS_PREFIX = '/record/'
const LIBRARY_NAME_PATTERN = /^[0-9a-zA-Z-]*$/
const DISCRIMINATOR_MAX_LENGTH = 64

export const IDENTITY_LIBRARY_NAME = 'identity'

export const validate_library_name = (name: string): string => {
  if (!LIBRARY_NAME_PATTERN.test(name)) {
    throw new ProtocolError('invalid_library_name', `library name must match ${LIBRARY_NAME_PATTERN}: ${name}`)
  }
  return name
}

// A discriminator for a library being created: the §3.7 charset, 1 to 64 long.
export const validate_discriminator = (name: string): string => {
  validate_library_name(name)
  if (name.length === 0 || name.length > DISCRIMINATOR_MAX_LENGTH) {
    throw new ProtocolError('invalid_library_name', `a discriminator is 1 to ${DISCRIMINATOR_MAX_LENGTH} characters: ${name}`)
  }
  return name
}

export const build_library_address = ({ manifest_cid, name }: { manifest_cid: string, name: string }): string =>
  `${ADDRESS_PREFIX}${manifest_cid}/${name}`

export interface AcChainObject {
  readonly cid: string
  readonly bytes: CanonicalBytes
}

// The three §3.5.1 chain objects of a static-AC library, and its address.
export const build_ac_chain = ({ name, type, write_keys }: {
  name: string
  type: LibraryType
  write_keys: readonly string[]
}): { address: string, write_list: AcChainObject, wrapper: AcChainObject, manifest: AcChainObject } => {
  const object = (value: unknown): AcChainObject => {
    const bytes = encode_canonical(value)
    return { cid: compute_cid_string(bytes), bytes }
  }
  const write_list = object({ write: [...write_keys] })
  const wrapper = object({ params: { address: write_list.cid }, type: 'static' })
  const manifest = object({ name, type, accessController: wrapper.cid })
  return { address: build_library_address({ manifest_cid: manifest.cid, name }), write_list, wrapper, manifest }
}

// §3.6.1: a single-key library's address follows from the key, the type, and
// the discriminator alone.
export const derive_library_address = ({ key, type, discriminator }: {
  key: string
  type: LibraryType
  discriminator: string
}): string => build_ac_chain({ name: discriminator, type, write_keys: [key] }).address

// §3.6.2: the identity library's address follows from the key alone.
export const identity_library_address = (key: string): string =>
  derive_library_address({ key, type: 'identity', discriminator: IDENTITY_LIBRARY_NAME })

export const parse_library_address = (address: string): { manifest_cid: string, name: string } => {
  const rest = address.startsWith(ADDRESS_PREFIX) ? address.slice(ADDRESS_PREFIX.length) : undefined
  const separator = rest?.indexOf('/') ?? -1
  if (rest === undefined || separator < 0) {
    throw new ProtocolError('invalid_library_address', `not a /record/<manifest-cid>/<name> address: ${address}`)
  }
  const manifest_cid = rest.slice(0, separator)
  const name = rest.slice(separator + 1)
  if (!is_cid_string(manifest_cid)) {
    throw new ProtocolError('invalid_library_address', `address manifest is not a CID: ${address}`)
  }
  if (name.includes('/')) {
    throw new ProtocolError('invalid_library_address', `address name contains a separator: ${address}`)
  }
  return { manifest_cid, name }
}

export const is_library_address = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    parse_library_address(value)
    return true
  } catch {
    return false
  }
}
