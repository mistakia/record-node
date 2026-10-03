// Conformance vectors ported from record-docs spec/fixtures (Record Protocol
// v1.1.0). Inputs and expected outputs are typed constants; vectors.test.ts
// recomputes every expected value with the same libraries the generators use
// (@ipld/dag-cbor, @noble/curves, @noble/hashes, multiformats,
// ipfs-unixfs-importer), so a porting error fails here rather than in a later
// stage's module test.
//
// F7's fpcalc and ffmpeg steps are not recomputed here; its fixture FLAC is
// already tag-free, so its raw bytes carry the audio identity and CID.

import { fileURLToPath } from 'node:url'

export const TEST_PRIVATE_KEY_HEX =
  '0000000000000000000000000000000000000000000000000000000000000001'
export const TEST_PUBKEY_HEX =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

const SIGNING_LIBRARY_ID = '/record/zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc/library'
const SIGNING_TRACK_ID = 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f'
const FIXED_AUDIO_CID =
  'zBwWX5GSt1YAYJYortZ4HSkWHD2JsDLjMmo5piYyZfgPqYiNMDEdPGcGLxjmt6nhmPApErDew6eVBdGECYtF6W73kZ1dk'

// F0 — §3.4.5 signing vector.
export const signing_vector = {
  unsigned_entry: {
    id: SIGNING_LIBRARY_ID,
    payload: {
      op: 'PUT',
      key: SIGNING_TRACK_ID,
      value: {
        id: SIGNING_TRACK_ID,
        timestamp: 1611272666695,
        v: 1,
        type: 'track',
        content: FIXED_AUDIO_CID
      }
    },
    next: [] as string[],
    refs: [] as string[],
    v: 2,
    clock: { id: TEST_PUBKEY_HEX, time: 1 }
  },
  unsigned_cbor_length: 468,
  unsigned_cbor_hex:
    'a661760262696478412f7265636f72642f7a6470754171797932794c66547065765334707866566164536d5331346f524e41584d766e41596574397a4b7753715a632f6c696272617279646e6578748064726566738065636c6f636ba262696478423032373962653636376566396463626261633535613036323935636538373062303730323962666364623264636532386439353966323831356231366638313739386474696d6501677061796c6f6164a3626f7063505554636b65797840636432346634346432656531666235646261393961366361633734663033393866356139303966333334313638386431396561353939323663386566363933666576616c7565a5617601626964784063643234663434643265653166623564626139396136636163373466303339386635613930396633333431363838643139656135393932366338656636393366647479706565747261636b67636f6e74656e74785d7a4277575835475374315941594a596f72745a3448536b574844324a73444c6a4d6d6f35706959795a6667507159694e4d444564504763474c786a6d74366e686d50417045724465773665564264474543597446365737336b5a31646b6974696d657374616d701b000001772755be47',
  sha256_digest_hex: 'fd55233a2c62c426ce45c3f7182645d0f031959dd919864030006a63e3749fc4',
  signature_der_hex:
    '3045022100ab7ece3c307e2a1061c83b93d32b62f49abf34d8d24ee167db515e23b33baec80220308677039a50f491c82d2ed95cc4df9f1bac097fa9e7089b488314180a42f6c0'
} as const

// F4 — §4.1.1 / §4.1.2 signed-entry CID (entry.hash) of the F0 entry.
export const signed_entry_vector = {
  signed_cbor_length: 688,
  entry_hash:
    'zBwWX7sbGgnamYuFHWzehnHysmRkS9rVvdgATL8CPab1ybY1j3xyy9F7Pu9m86AgsyCWfXbBPdxXfhEFzd6fdn14uEVAF'
} as const

// F4 child entry — §4.1.2 (v1.0.2): non-empty `next` as a plain string.
export const child_entry_vector = {
  unsigned_entry: {
    id: SIGNING_LIBRARY_ID,
    payload: {
      op: 'DEL',
      key: SIGNING_TRACK_ID,
      value: { type: 'track', timestamp: 1611272666696 }
    },
    next: [signed_entry_vector.entry_hash] as string[],
    refs: [] as string[],
    v: 2,
    clock: { id: TEST_PUBKEY_HEX, time: 2 }
  },
  unsigned_cbor_length: 388,
  sha256_digest_hex: 'e1241cb701825227663c967fc89d188ba14f6f462a8754ef969f8a39df107906',
  signature_der_hex:
    '304402205ee933257f49cf6f3a25738096986cc7e325125ceb2fc9e1c948d723c07178e8022060566edab9df3762d15ae1b1833dd501f2a48363b0110478ea068b3da575087b',
  signed_cbor_length: 606,
  entry_hash:
    'zBwWX6N1WUQhrDeFC3oNsPdZx2mQT9jLiPTLBDk32c6WPDZDSEr28Nuh9DgoeXwPLjLXQY7xfFkrWihvgsTeyGQ14UMT7'
} as const

// F1 — §2.3.1 sha256 and content CID vectors.
export const sha256_vector = {
  input: 'hello',
  output_hex: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
} as const

export const content_cid_vector = {
  payload: { hello: 'world' },
  cbor_hex: 'a16568656c6c6f65776f726c64',
  cid: 'zBwWX8pQhjGaQLy57vXmwHUBxxMDeft5dzud3gari9HqUpFFzqEqfLLspwfCw7k9YSNz59f5JWJZnqP8eN8SDHwEEwrFk'
} as const

// F2 — §2.2.1 envelope vectors (track, log, about).
export const ENVELOPE_TIMESTAMP = 1611272666695
const ENVELOPE_LIBRARY_ADDRESS = SIGNING_LIBRARY_ID
const ENVELOPE_FINGERPRINT = 'AQADtEmSaImSJI+jiyiOI4+jHE+iJI/jHE+iJ4+jHE+iJ4+jHE+iJ4+jHA'
const ENVELOPE_LINKED_LIBRARY = '/record/zdpuAxgMzJaTqK1HQU6CKQ9p2vUaG4eR9zUk4HwYj9Q1pK7DC/library'

export const envelope_vectors = [
  {
    type: 'track',
    id_input: ENVELOPE_FINGERPRINT,
    id: '85709b6f3c244870af362add509f1f966451d299657de5a8c868c0092ec2173d',
    payload: {
      hash: FIXED_AUDIO_CID,
      size: 4321987,
      tags: {
        acoustid_fingerprint: ENVELOPE_FINGERPRINT,
        title: 'Vector Track',
        artist: 'Test Vector',
        artists: ['Test Vector'],
        album: 'Spec Fixtures',
        genre: ['ambient']
      },
      audio: {
        codec: 'FLAC',
        bitrate: 1024000,
        duration: 270.5,
        lossless: true,
        container: 'FLAC',
        sampleRate: 44100,
        numberOfSamples: 11923050,
        numberOfChannels: 2
      },
      artwork: [],
      resolver: []
    },
    payload_cbor_length: 438,
    content: 'zBwWX8s8jVcoQvakEsZzXaVeakz5eXiyaqb6jPBdQ4wYyz2LT8iKXYneYTrRWxqtEhcyyv8sMcL5ivsGosuE4saCCimeb',
    envelope_extras: { tags: ['downtempo', 'fixture'] },
    envelope_cbor_length: 230
  },
  {
    type: 'log',
    id_input: ENVELOPE_LINKED_LIBRARY,
    id: 'cf040389e127294af13897e09beff5a7485eb26e7525dce9d5e1182db5dbafb1',
    payload: { address: ENVELOPE_LINKED_LIBRARY, alias: 'friend' },
    payload_cbor_length: 89,
    content: 'zBwWX9D7vCE9TVXyvumtVe2u66g4gGy56wqWVfDFM54WZ7dxrj8BV83AS82Tnc68P6cTy8hkonpuoP32Bq4ntT6vqetWR',
    envelope_extras: {},
    envelope_cbor_length: 204
  },
  {
    type: 'about',
    id_input: ENVELOPE_LIBRARY_ADDRESS,
    id: 'd4ebc6d0663387a931b1b906d9efe078ab4d963e2a84a67f1c83cc83aebf0169',
    payload: {
      address: ENVELOPE_LIBRARY_ADDRESS,
      name: 'Spec Fixtures Library',
      bio: 'Deterministic test vectors for the Record Protocol v1 spec.',
      location: 'in vitro',
      avatar: null
    },
    payload_cbor_length: 194,
    content: 'zBwWX7ax1zjie7XCTHyf3gyPrF56FJSZQCemrWE4CUHg2RisFqkPhXHa4F2L1YzHRXYyLvMYgHN5LebjqWfseon5TQqCg',
    envelope_extras: {},
    envelope_cbor_length: 206
  }
] as const

// F3 — §3.5.1 AC chain and §3.6 library address.
export const ac_chain_vector = {
  library_name: 'library',
  library_type: 'recordstore',
  write_keys: [TEST_PUBKEY_HEX],
  write_list: { cbor_length: 76, cid: 'zBwWX55HXWPLKbELsvnimVMZhmtAiiM7vCeyLoyeP8AibJtNQ1XYD6g4rY3QMnGXVD6w5HUDH8n5DWY7KVXkzvFqaVR7K' },
  wrapper: { cbor_length: 124, cid: 'zBwWX8Yoh5RwS7v61cXCk96SXiE7dexudEawmsr2DFswc14YmqPCfZ7w6Tf818jMAj6nSC1L14FL8dccFw5Cvh6D29RNC' },
  manifest: { cbor_length: 143, cid: 'zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8' },
  library_address:
    '/record/zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8/library'
} as const

// F5 — §4.4.2 current-state race set. Entries carry placeholder signatures;
// resolution depends only on clock.time, envelope.timestamp, and entry.hash.
const RACE_CONTENT_PREFIX =
  'zBwWX5GSt1YAYJYortZ4HSkWHD2JsDLjMmo5piYyZfgPqYiNMDEdPGcGLxjmt6nhmPApErDew6eVBdGECYtF6W73kZ1d'

export const build_race_entry = ({ tag, clock_time, envelope_timestamp }: {
  tag: 'A' | 'B' | 'C'
  clock_time: number
  envelope_timestamp: number
}) => ({
  id: SIGNING_LIBRARY_ID,
  payload: {
    op: 'PUT',
    key: SIGNING_TRACK_ID,
    value: {
      id: SIGNING_TRACK_ID,
      timestamp: envelope_timestamp,
      v: 1,
      type: 'track',
      content: RACE_CONTENT_PREFIX + tag.toLowerCase()
    }
  },
  next: [] as string[],
  refs: [] as string[],
  v: 2,
  clock: { id: TEST_PUBKEY_HEX, time: clock_time },
  key: TEST_PUBKEY_HEX,
  sig: '00' + tag.charCodeAt(0).toString(16).padStart(2, '0')
})

export const current_state_vector = {
  entries: [
    { tag: 'A', clock_time: 5, envelope_timestamp: 300, entry_hash: 'zBwWX5sj8wEnAJ8k1ZtrsqKpi6EDftGkcGjNJeepSKbU1YhnVgLaCDu9yFFjmT8MNQhnbWayLMVz93eQhgmsFzWxnVA1U' },
    { tag: 'B', clock_time: 7, envelope_timestamp: 200, entry_hash: 'zBwWX88KGtBXr3KSnx3VRFU3kAdzAcR1g4GrLCaMdLdi3BWepg4nvkcEUMDWXudVjLD9AbG6672Qzo3SYoDZJ89cfYLs1' },
    { tag: 'C', clock_time: 7, envelope_timestamp: 200, entry_hash: 'zBwWX6cFvYVau8nCB7u6v4sBWDsLJ8LNxLk8QLovwhSPPau38u8vSNxKqMy7ksxaNasfq8C5V4v9QvyDHoYp2MWz5TRDF' }
  ],
  winner: 'C'
} as const

// F6 — §5.3.2 LoadedAboutEntry and §5.4.1 heads message.
const NETWORK_LIBRARY_ADDRESS = ac_chain_vector.library_address
const NETWORK_ABOUT_ID = '4e44c1dc1a37e40a1305a7d88f3b49c0e83969c9d0319da7a64afeb25817a742'

export const loaded_about_entry_vector = {
  message: {
    hash: signed_entry_vector.entry_hash,
    id: NETWORK_LIBRARY_ADDRESS,
    payload: {
      op: 'PUT',
      key: NETWORK_ABOUT_ID,
      value: {
        id: NETWORK_ABOUT_ID,
        timestamp: 1611272666695,
        v: 1,
        type: 'about',
        content: {
          address: NETWORK_LIBRARY_ADDRESS,
          name: 'Spec Fixtures Library',
          bio: 'Deterministic test vectors for the Record Protocol v1 spec.',
          location: 'in vitro',
          avatar: null
        }
      }
    },
    next: [] as string[],
    refs: [] as string[],
    v: 2,
    clock: { id: TEST_PUBKEY_HEX, time: 1 },
    key: TEST_PUBKEY_HEX,
    sig: signing_vector.signature_der_hex
  },
  json_byte_length: 1060
} as const

export const heads_message_vector = {
  json: `{"type":"heads","heads":["${signed_entry_vector.entry_hash}"]}`,
  json_byte_length: 122
} as const

export const NETWORK_MESSAGE_SIZE_BOUND = 256 * 1024

// F7 — §5.5.1 / §6.1.5 / §6.2.4 audio pipeline smoke. The fixture is
// record-docs spec/fixtures/audio/chirp-10s.flac (v1.1), vendored
// byte-identical; it carries no metadata, so its raw bytes are the
// tag-stripped blob.
export const audio_pipeline_vector = {
  fixture_path: fileURLToPath(new URL('../fixtures/audio/chirp-10s.flac', import.meta.url)),
  fixture_name: 'chirp-10s.flac',
  duration_seconds: 10,
  fingerprint:
    'AQAAO9HSRskFaTmP8EezzAze486RpyfSE7ObBPc0_DixJ9QkDfWNRM-Rf_jx46mO_kj6Bcdd7McTQvuRPjLKHKc_JD-iF19jXMV_MFHiwPlxRMqN48Fz42eO5Sc2Pxl-4eGPq4uR20JDyzjc-NjvoHkWMN-ywyfGD-mPZN7RPwBAjAUEIWIINgJwoSQilCgPmBDMeSMAEo4yQhQjUBIiBFRUVAKIAMAwgAAwSKAgBCKAAUIBIAA',
  track_id: '13f92b74d4d33accd2424b87914fbc6d087b7557fb2166330756bdcddcd8b6db',
  audio_identity_sha256: '030b44581e3f0bc77407faaf3958de78a95b257b1475bf0a65dc4a5df45a750a',
  audio_cid: 'zb2rhWrAP3dch4trZWGArAEEN8mqFPhsQ2Jojbedxdq8MtCgH'
} as const

// F7 multi-block input: byte[i] = i mod 251, where import profiles diverge.
export const multi_block_vector = {
  byte_length: 2 * 1024 * 1024 + 1,
  cid: 'zdj7WZqdXsKQ1j19s9xaxhLp5oFvFF51WaWK7BVLgbZvB46n5'
} as const

export const build_multi_block_input = (byte_length: number = multi_block_vector.byte_length): Uint8Array =>
  Uint8Array.from({ length: byte_length }, (_, index) => index % 251)

// F8 — §3.6.1 / §3.6.2 address derivation from (key, type, discriminator) for
// the §3.4.5 test key. The recordstore `library` row reproduces F3.
export const library_address_vector = {
  key: TEST_PUBKEY_HEX,
  manifests: [
    { type: 'recordstore', discriminator: 'library', manifest_cid: 'zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8' },
    { type: 'listens', discriminator: 'listens', manifest_cid: 'zBwWX67a7mbUHRB8maxG6K3CdGyfRLnTv2bFGhvmmpw1SA4Aqku6qy8y6FUar8S9SXrTrkokZH9jTjtQBDRZ6HpELshLu' },
    { type: 'recordstore', discriminator: 'mixes', manifest_cid: 'zBwWX7ayGQu2GevKxpfRiHbcuNjtqkbRghTqUtCPRKbeRGLdtphXDbHThj9HcnMwMXQhF9GZY9rhYt7Yaibr4Z5Bsed4o' },
    { type: 'identity', discriminator: 'identity', manifest_cid: 'zBwWX5yfKGoxN42dyykh9tRxq4CjbydSPBpNkVzLe5bmjCRib33F7AiUsRGchrTCgvjDvRVJsC89Rv7Wfk17n8sqMkEFx' }
  ],
  identity_library_address:
    '/record/zBwWX5yfKGoxN42dyykh9tRxq4CjbydSPBpNkVzLe5bmjCRib33F7AiUsRGchrTCgvjDvRVJsC89Rv7Wfk17n8sqMkEFx/identity'
} as const

// F9 — §4.8.1 / §4.8.2 identity-library entries of the §3.4.5 test key, each
// citing the one before. The friend library is test key k = 2's `library`.
export const META_LOG_T0 = 1700000000000
export const META_LOG_PIN_CID = 'bafkreiadbncfqhr7bpdxib72v44vrxtyvfnsk6yuow7quzo4jjo7iwtvbi'
export const META_LOG_PIN_SOURCE_CID = 'zb2rhWrAP3dch4trZWGArAEEN8mqFPhsQ2Jojbedxdq8MtCgH'
export const meta_log_vector = [
  { label: 'library PUT of the §3.5.1 library', signed_bytes: 682, entry_hash: 'zBwWX6yJT8sDseJEr3iaGgYqsKiejaKBizBNPiSDeoV2yXHjkXXqcHL6JYF7xqGy5m9WQT1scdXRmh3BLoq7xp8K7VLZC' },
  { label: 'link PUT of k = 2\'s library, alias friend', signed_bytes: 785, entry_hash: 'zBwWX6tGPpW4hsRc5AhPJJhFVopAeJXmjzj9zm1aXrvnoUo9XdGZ2gRiAcmSFdovBmfHnC8rc4ny59uWSrJGAz93gdT1J' },
  { label: 'pin PUT of the §6.2.4 audio CID', signed_bytes: 719, entry_hash: 'zBwWX7isyhFyCGzkHqmj5XZ4Auq7rss84UsPqtb4LCXsJmJwschU9Nnpn9PkBkFnSNFX2dA8t55QbMFfmyNZUu1HmFkuB' },
  { label: 'link DEL of the friend library', signed_bytes: 650, entry_hash: 'zBwWX94oXV3jxM3ZchvB6FVBDJ6va4BhRvLinaHkaMGKcTrmV5fJDYtJXFGXMxB4Sra39YT1ugrBTrWjAzKtYdTV2RRSE' },
  { label: 'library PUT of the own mixes library', signed_bytes: 775, entry_hash: 'zBwWX8emvUUZidkjMXTqY1FkrL8Z3byJyh3Pvb3GJg613EknTdmNFM2C2yDePJ9q6biMELLiS1bwnirGC1i2NSDctnxit' },
  { label: 'link PUT of mixes', signed_bytes: 772, entry_hash: 'zBwWX8sz9N4cENbiU15tWb1kQUeWuAM1ocugdCCh1kYjjv7r2VVP8pMXXoiKW4YEff8Vkr6LW6Vv1cJ1QHVdH7NfwKQ6n' },
  { label: 'link DEL of mixes', signed_bytes: 652, entry_hash: 'zBwWX9zPbVPvWVdLmxxX3JfEi9iXGsuoP9Q1SnebpU6JKU2SAjMCputjt3DPiNzsE6TAmUYAf7Kh57rJvSbKdHJd5ebGa' },
  { label: 'library DEL of mixes (retire)', signed_bytes: 655, entry_hash: 'zBwWX9m9dkzAdkitjJUAvBDd3zt4n9W2Y2ziGtzU5qnhRJUvNYVBjfggvBV6ZnJfHFPYmKhbh8X8QoiJJKtGx1kvD1qrf' },
  { label: 'a stray library PUT of mixes', signed_bytes: 773, entry_hash: 'zBwWX8M4t6XTCqyoP198pk8KUbJj3N4vWmJ6J5ST4uqsQMCCQmy9RB6p2b1ejNXbSNoVTyvMK42TpSbVMWnSGm4HApgKY' }
] as const

// F10 — §3.5.5 to §3.5.10: capability C, a write W under it, and the owner's
// revocation R, in the F3 library. capability-vector.ts rebuilds every case.
export const capability_vector = {
  case_count: 327,
  C: 'zBwWX61Hk9TaWwav3Kd5fTzdx4TEyJTU4NzSjhqDqDjyz9UoQPm7poFUmfJMQxUQU6VCbbF53C9MJbQW8HZGdwiNSb1Y1',
  W: 'zBwWX9GLKF4xVufTPhStjkvwmB1NV2imR8QiGJD755BqTdsPc51ur6hEyS3qBoTwj9mcofwTYhPwvcSog53hmjp2f2NL8',
  R: 'zBwWX7UthQBfd1XSMNssAhMwaKo38puex8DcjceV4cV3Gn59nkJYyvoDivq62GeFaEeskziMh6wb5EwBuLnUcn5DUsSwx'
} as const

// F11 — §6.1.6 degenerate fingerprints: literal fpcalc output (-json
// -algorithm 2). The silence fingerprint is shared by 172 files of one
// deployed library; the v1.0 sine is the old F7 source.
export const degenerate_fingerprint_vector = {
  silence: {
    fingerprint: 'AQADtEmUaEkSRZEGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    track_id: 'b8702767c27bedd78aad13742796018136471b82d99e931db8304472c3a69304',
    values: 948,
    distinct: 1
  },
  sine: {
    fingerprint: 'AQAAE0mUaEkSZSoAAAAAAAAA',
    track_id: '20599ccf9f5efb8cc1d6e2ae464471f6f8fab82066a42579b07024d7673b1005',
    values: 19,
    distinct: 1
  },
  music: {
    fingerprint: 'AQADtEkySYkSJVKU4EXzo8dDo2-H5sWZg-Xxo-HQP8LDDu0LfyaOh8WP5vnwXOhb-Bk-NviDi_Bz9MdDo9YJV_lwnMWPxsmH53iWDu3gZ0Zf42gHLYdO40fzoGco9DlM9Mcp9Id541nRp0Z_mPzQp_iOeoP1HB-NHzZaPsONPlEMSzv6zDiFH-3ROB-uhMbpoTn6LCX-BGioHF0_PFkaoROaZ3iZ4EeLxvlwpcYzE82PPiweoOGO_vhCozf8zOhL4TRaDs0_XBRaHj7e7NBeotdhfkFnWbhYQjtMHj3DBD9aNIfeQfaF7kbzpcFJo0d69Dny7OhzaHlxzxGe4Rxs8XgCPZnR6WieGa_xo0Xz42GDEw2PPsRzDX0Okx_6FO2ODz5OCz8MrdIz3EYPS2mgbxf6oj8aSscb4Tw6ZjmaZ3iLP2jRHGc-nAkboT2aZ8Zr_EF4hPHx1MLzDM2HPjTeDC2HxiK-BLKUzOjRPPNwxviDhhx6sdArXEo-NCf6sHjwo-GO_gseGm0aD65oInxo_EFjoQ9D5EefHL6HPuzwJgJMFc8yXHMErTMaNTNeC2eDljsaix0u6MmMRtrRz3iNHw2H_nhC4zQajujD4k9wNNzR46TRw2eJnkYfmDx6sbiOfjEsRTRq5cKLBn2OX_jEoNHRR3jaCP_QohmPq8WZXegPc3lwHb8AP0XPQ3vgF-GP92gvNCuRJ_iUCRp5ImUU-OiPM-jnIf2F10M_FQ-NH41E9Do-Gy-aG6divMd5fCELH28M8cePC_9goeWJN9CFWvRgLmtwHYeNvkUfWfjho9dxG9_R_CiPj8YfDw2HK2twDj8MvYP25OhfND8E7Yd59Cx-9DTM0ehz4UVj9B-eo6MZ-Eef4zX6B6Z09GKHH12kfEi54cqDH7-QHi_67NAeUmg-_HiOlkOzsvgFXVE8NOODNsrQwz764g-6zoFt9BHe4g_Cohnx4wodlLJhaZGR58I_lIe2w1eO8HrQG81xdBrRrAwe5MpUaMszmFF05Dx89OizFHYu5Df6Fk8IHX0Okx_0HR9hHTmjNDCP63iOHI-hwy6LHj8ueIXO4Mpx6UPDsUGtHCW8HW-Lr4K_GBeeozf-oUUzCXmOMxbKH2aUB_nwDxqPPvAl5EmOc2h0I0fDC2XJQPeFMyXCqHPwKIP3Ix9jvIW_F7_w5tAT3PhhHu-HUD16CpexZ7iDoz_yomoOUc02aB9eoc_RkMR3_B9K2WhkQteDtxEatMIfvBnMIz-eB29h4sf-IORyTOEqyJaKkqwE-8JxG4_hf9C248HDwE5wvHqE_kOYsTgfhE89NLoh3Fk6NGeFsKqHHHoiI-fRpNGKKjpxfA7sRCV-RN8DLf8QntRQHdZTRI90vHHx4c0CURdaJTjePGh-tEPsPME7pMaDJ2SCJkfxfPiDHo0SCz-ORtmhlegdeAsv_AKeJthpQZmaoxdeoW_RkDiuo3mLdsMfPG0GUTiFL0_Qo-mhLzueB7nhpBPeEveC3kOYhzgF_WgeMkSf4Z-hu0HnD1puvMJzmMTH4v9QykYjQ5eLl4nQoMeXB3-Ghkd_I39wV4OzHT92HeEfTBkryKJUlK8EOxeO29iNfYYW7cWDN2icEC3-4dEjNDvCLg_y1EOjGxruLB16VkipegiLJzKSH1W3okl0XPgOX5WwK0f-QMv1ITypofphXUYeKSLW5vjwZhD1o1ViHPeD5j3a4c6DvEHq43jIoA-a4Pnwo0cjUcKP_-hYQ8tC_CjJSvB2AbewMw6UPR-6C6_QFw0X4HqE_kPzCeeDtxm0iKiFb3nQP2ha4Tl0hcadw07x6MT_CBqPMM-Ch7jRPEqsoD9yPoSOUGaKRmnk4IwmTMlL9EepBw2XH-fxS8h1HSLPIN8HslKOSzEyHZd0qGKWg85RMrvha3hiPBCPZomNkzGeC36Q70jaIa9y_KieHiH3QE-O8A_8FD6O5omTCOeFXEfy4_nx57iUwcnl48c1I38aiIuS4z9OhDnR_OB1_MajdUnQPB_sHmcG5RecZBH6YDwjwj-eo5l0lOFxFjEdaLxyNNSnIOvxJiuyZ_ChUuGJ82CY6IWfnXhU6MJxlBlTvDt-Be4O9cgXvDruGKctI1ceaMyP9HOOEz6ay8KZJxGOXEiuEJfxLTqqZ0OjH_-FFwk5psF14zv6I8zhHyylmPi5CE0nLzj8bAifUUgiNbDio3dCTHpINEepCw33HK9xRkIsmYIWnjlC7gNZKcelGFly1BRUdTlBH6WU3fA1PDEOPShl41mNZxaaB_UOtUP-HOdRvQi5PoWeHOEf-Cl8HM0TJxHOC9eRPBzyJcfj4ZEyOJeP5_hx-zCXU_gefEmC_jCaMZeQ502C5xB_5MiX4V-N9yl-482DLJQJLyt6NriP7hlubQi_I7mUK3hO3MPjwrmIdw-eKMeVH9R41JTxB_kFoVI-5A-epQp8xDz0BfmkH4-N05bxPciTI1k-B8eP_sKTJ8KPvEfyjBEAC5hlAhCCJBCGASGaUYAwI4BhRgEFEDNEPKOIQgwIUJUBQAhCiCUEMEAIAQYJghwRFjBhmVHGMCAYIUYBxowxDBEBijBGAcEEkQoJIABhSinBDJCGAGMVMEgIAoQ3whsJGDPAMQaEIoIQgBxyjghFCGBECGsIAYwZIIwAgDEikGKCCoodYIwAKAgQoBEiDBOMCCgAAYJaxRjxhhHGDECKCUZQs0YBQgVQRggLjDPMCsUMQwQgIBBSBAkgIFDCAC6IBYgRQJRgzABCCDKCEESQEoAS0YywCiEwhICKAGUMYA4RgKhCEhghEBBGEWeEEFYYZowRhAkiAIEECQoUQVYAQClgRDhCMBKOCMYMMwgZoighABhjwTcMKECBIIAI5QUhQCEoJEJKSKowM0I6QIxBwgHJCFNIEQaAEExQBRChRAECiBFAMEEYUcJYRzghihBAlSAUWQoMIkQAYZgTVirACCMAEUMIooIYUA0BwhgBCAAEKQDAM5AAgIQlBAhODRhEEWGVkowoRAQUCQGiqFGSCrAMcEIBIywQRBkJnAIUAiCAMQRRZRARQDBgBDNCAEYAIIAQYYQgCCIDKnEMEIEIEAwCwB0QQCEDiBAGIMSpIWAQQICgjjHLiFKWOEGABIQaQBhliggDjGBAIMCUoAAAAIgDkgIiBBLMMKCIIAAgYYgRCCiAFIACQAYII9hAACgwggFHCBKoIIGYAEoICIgEBFglhEIOOC4IYYQYIABDwCJEKECUKSGkEAQQyYCAzCECmEEeCYGAYIwI4ThBACXBoSCAAkCUUggxQgYxQCEhlFHKAMIMQEABIAWADBGGIQCAASSAIwQJVJBQDAjgoSCAOqIAUQYpRITgQgCDgBDGIaAIoAAQAAhBjgpBGADAISCAMQIyYQ0QgALChBLWMSMgQEowAA',
    values: 948,
    distinct: 786
  }
} as const
