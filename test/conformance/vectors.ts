// Conformance vectors ported from record-docs spec/fixtures (Record Protocol
// v1.0.4). Inputs and expected outputs are typed constants; vectors.test.ts
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
// record-docs spec/fixtures/audio/sine-sweep-5s.flac, vendored byte-identical.
export const audio_pipeline_vector = {
  fixture_path: fileURLToPath(new URL('../fixtures/audio/sine-sweep-5s.flac', import.meta.url)),
  fingerprint: 'AQAAE0mUaEkSZSoAAAAAAAAA',
  track_id: '20599ccf9f5efb8cc1d6e2ae464471f6f8fab82066a42579b07024d7673b1005',
  audio_identity_sha256: '8b96e6aa53240d01736fb444f55ce8184e78d32dfb2013ad48f14c3592308d69',
  audio_cid: 'zb2rhg3BKZhTYqV2eSH7d2LXvjDdfyJUX9izYRre6NSG4z5WG'
} as const

// F7 multi-block input: byte[i] = i mod 251, where import profiles diverge.
export const multi_block_vector = {
  byte_length: 2 * 1024 * 1024 + 1,
  cid: 'zdj7WZqdXsKQ1j19s9xaxhLp5oFvFF51WaWK7BVLgbZvB46n5'
} as const

export const build_multi_block_input = (byte_length: number = multi_block_vector.byte_length): Uint8Array =>
  Uint8Array.from({ length: byte_length }, (_, index) => index % 251)
