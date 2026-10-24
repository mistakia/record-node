// Conformance vectors ported from record-docs spec/fixtures (Record Protocol
// v2.0.0). Inputs and expected outputs are typed constants; vectors.test.ts
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

// F2 — §2.2.1 track envelope and §2.6 inline About record.
export const ENVELOPE_TIMESTAMP = 1611272666695
const ENVELOPE_FINGERPRINT = 'AQADtEmSaImSJI+jiyiOI4+jHE+iJI/jHE+iJ4+jHE+iJ4+jHE+iJ4+jHA'

export const track_envelope_vector = {
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
  envelope_cbor_hex:
    'a5617601626964784038353730396236663363323434383730616633363261646435303966316639363634353164323939363537646535613863383638633030393265633231373364647479706565747261636b67636f6e74656e74785d7a427757583873386a56636f5176616b45735a7a58615665616b7a3565586979617162366a50426451347759797a324c5438694b58596e65595472525778717445686379797638734d634c35697673476f7375453473614343696d65626974696d657374616d701b000001772755be47'
} as const

export const about_record_vector = {
  record: { type: 'about', v: 1, timestamp: ENVELOPE_TIMESTAMP, name: 'Spec Fixtures Library' },
  record_cbor_hex: 'a4617601646e616d657553706563204669787475726573204c69627261727964747970656561626f75746974696d657374616d701b000001772755be47',
  operation_key: 'a4262e1c9bcbc1721eb3fe13558154460a2b2a2d307daa32532478526ce6ccb1'
} as const

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

// F6 — §5.3.2 the signed entry carrying the F3 library's About record, as an
// announcement carries it, and the §5.4.1 heads message naming it.
export const announced_about_vector = {
  entry: {
    id: ac_chain_vector.library_address,
    payload: {
      op: 'PUT',
      key: 'a4262e1c9bcbc1721eb3fe13558154460a2b2a2d307daa32532478526ce6ccb1',
      value: { type: 'about', v: 1, timestamp: 1700000000000, name: 'Spec Fixtures Library' }
    },
    next: [] as string[],
    refs: [] as string[],
    v: 2,
    clock: { id: TEST_PUBKEY_HEX, time: 1 },
    key: TEST_PUBKEY_HEX,
    sig: '3044022077980398e1cbc79f8706c733403a71183f69974084da311312b8eda85ac56112022012261dcc6177fd0f98f89e43c944cf6f6e23711db27fcd152ffa551ba32a0cb4'
  },
  entry_hash: 'zBwWX58W4xgGQCyXAQHz17NN4gavMie9ABm2cMExP1Tt7F1iK4dvop4H7pPnTYQucmGCyXgNY3ohXG5Ai13db918VJUGp'
} as const

// F6 — §5.3.2 the signed entry carrying the §3.4.5 test key's profile record
// in its identity library, as an announcement carries it.
export const announced_profile_vector = {
  entry: {
    id: '/record/zBwWX5yfKGoxN42dyykh9tRxq4CjbydSPBpNkVzLe5bmjCRib33F7AiUsRGchrTCgvjDvRVJsC89Rv7Wfk17n8sqMkEFx/identity',
    payload: {
      op: 'PUT',
      key: '1900eab6c028483d7126599ee6f50de0d27907b5c65fa90524580b4b0f9852b0',
      value: { type: 'profile', v: 1, timestamp: 1700000000000, name: 'Test', bio: 'A fixture identity.' }
    },
    next: [] as string[],
    refs: [] as string[],
    v: 2,
    clock: { id: TEST_PUBKEY_HEX, time: 1 },
    key: TEST_PUBKEY_HEX,
    sig: '3045022100f29bde1b588e288d6adbe0378f538de1c37046e69be9e1961c6d82e1bf1c1b380220237abdda92bff3769642bfac47a1f5fc308bc90a52a00df03c032c51c63f9d42'
  },
  entry_hash: 'zBwWX8f8xRXvThTFm9BD4zvP3Y5SMQX8n9R6TAu65RijGUsbDGFNscD7SYwZq9qPjJ44LKNoBJpXhVkoFWdM9qS1pfAM3'
} as const

// F6 — §5.3.2 the announcement of the F3 library, with its About entry and its
// owner's profile entry: the exact JSON and its length.
export const announcement_vector = {
  message: {
    libraries: [{ address: ac_chain_vector.library_address, about: announced_about_vector.entry }],
    profiles: [announced_profile_vector.entry]
  },
  json_byte_length: 1468
} as const

export const heads_message_vector = {
  json: `{"type":"heads","heads":["${announced_about_vector.entry_hash}"]}`,
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
    { type: 'recordstore', discriminator: 'q4ht7nxk2mzv6wrd3pjc5bfgya', manifest_cid: 'zBwWX9z7TWUE6xdpijU6cLpby3exmcRCZVoZPsdoLRaKHjUUhzzrU3b96mRnof7oiUUwsGasZfr5gtJ8fuCdrv4Wk8Dtm' },
    { type: 'identity', discriminator: 'identity', manifest_cid: 'zBwWX5yfKGoxN42dyykh9tRxq4CjbydSPBpNkVzLe5bmjCRib33F7AiUsRGchrTCgvjDvRVJsC89Rv7Wfk17n8sqMkEFx' },
    { type: 'labels', discriminator: 'labels', manifest_cid: 'zBwWX8NMGhVpD5UkPV6zKreKiHBNEUdK7FfgN3fpYn3aJiKxVFytYouYKFEiLvv3VqZCpTRhxcU7ekjWjJki9tXbfwm8U' }
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
  { label: 'library PUT of a second own library, random discriminator', signed_bytes: 796, entry_hash: 'zBwWX6nT9Emb12f1Rxneu5RsNzeydWpBKjKeyyzrZ15CWZK1TxUEsLYh86ViLDkdXQVJRGpzhggZr3xMRF32LMHgt1Xfa' },
  { label: 'link PUT of the second library', signed_bytes: 791, entry_hash: 'zBwWX5fV5s75PvpNVUkMnDLLyPZa6ZjX7Bn3muUZXojLYrMMyZTZNRhdkeePDfnfNLGvUiQSh91vmHfSfoF3gHPKQG3zH' },
  { label: 'link DEL of the second library', signed_bytes: 652, entry_hash: 'zBwWX7oAf1DHnFTE7QYm6qkeuAeBjEU3D8JUGz3DjKoK5psbmpFBa2AZvBtb5TLMAhDEvtN3P1cbEzPx1Rufey7i9CFk7' },
  { label: 'library DEL of the second library (retire)', signed_bytes: 653, entry_hash: 'zBwWX9yYbHJniPuFXdbbF2SUbXMwzr8Y5LeCCx2bd95XXerVaG48aLmv7EdPFoq8LqGSdLqHqY3TbbBKFmh5cktm6kFut' },
  { label: 'a stray library PUT of the second library', signed_bytes: 794, entry_hash: 'zBwWX59zuffDARffT9ABnjKm5xPUgtPqQtvFbz8Ev9drgkjkymfcPaeEueMaCXpcHSF717C9hZUzYfUwtLKSv3Dxa16nk' },
  { label: 'profile PUT with a name, a bio and the pin CID as avatar', signed_bytes: 758, entry_hash: 'zBwWX9CDL9zdEjBGKyj9XoXktTPNQSegzptAUZhajZWFGSXYQy6D91RKguCdt2rvdW9bzbP8M98C4SkZDr2YHA4kqv4eb' }
] as const

// F10 — §3.5.5 to §3.5.10: capability C, a label write W under it, and the
// owner's revocation R, in the F3 library. capability-vector.ts rebuilds
// every case.
export const capability_vector = {
  case_count: 345,
  C: 'zBwWX9ifGJ2hJUEXcWfBa8XPPXJeTVmueycsBVhJgF1LcXtKDhTDfXfGZJ6ThHMLSY55bdcN4kayr367jCXkmTj1X8kXo',
  W: 'zBwWX9PQytHs1BvwyY41t41aqM2eG5qDyHJBcF4whar1Txj1iH2VpRDoPiuVDhpg18JTpahPFkhtJ6BCjfm9i8nKtMsXe',
  R: 'zBwWX5Pjot9No4iFvojbv2EpRP4up8DzUgpwuH8TmiKrEpGBgxJxZ7CvbTBt7cmfN1DH9pZQE3Bm7NCKTToPMoT91Frd6'
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

// F12 — §2.5 and §4.4.2 label records in the F3 library, owner k = 1, each
// naming the entries it cites: per-pair state, a tie broken by entry.hash,
// and labels outliving a track DEL. Track B is held by no library.
const LABEL_TRACK_A = 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f'
const LABEL_TRACK_B = '0c867c27728c4c1f9273bdc944f6043ebdbb98b7599ae90486549717c06418d6'
export const label_vector = {
  track_a: LABEL_TRACK_A,
  track_b: LABEL_TRACK_B,
  entries: [
    { name: 'E1', next: [], record: { timestamp: 1700000000000, set: [[LABEL_TRACK_A, 'mix/x'], [LABEL_TRACK_A, 'lifestream-radio'], [LABEL_TRACK_B, 'mix/x']], unset: [] }, key: 'f38f274cb0b9b709657ca3815bfa9a574b88ce16e5eb2afd814e93aba2e84383', entry_hash: 'zBwWX9xHYcyaGijdXW1c7cBGTT1BMX7puKLzv8sxW88xiZEuhk6Jwji8bXpixuFNs5xZUvRV4eEvcHdWh6HLhsNmJX9nT' },
    { name: 'E2', next: ['E1'], record: { timestamp: 1700000000001, set: [], unset: [[LABEL_TRACK_A, 'mix/x']] }, key: 'f228c4f7c920f3062473aeffe3dd70f42f6af466e268b2afd9b63fb8c149e0d6', entry_hash: 'zBwWX9xxmJBCHW9iy8X8daY14uogwZGqAmALsxn99eT3UxNSzeA86BNFPNw6hNsF9NYUn1wNeg9RQ2oWdScGeSpf7CNrg' },
    { name: 'E3a', next: ['E2'], record: { timestamp: 1700000000002, set: [[LABEL_TRACK_B, 'y']], unset: [] }, key: '9760b282a8c46eec35d64aca23f7089eeb793f81f92af45ad43b84ead3e05852', entry_hash: 'zBwWX83N6tEvQ2q38PvPhS8LFnzZkatX5REcN2LXMfUVXqqhgJufdPrmVRepZ58ubSJt2kmx4o43yX1gKASKNbLshrJ6d' },
    { name: 'E3b', next: ['E2'], record: { timestamp: 1700000000002, set: [], unset: [[LABEL_TRACK_B, 'y']] }, key: '39a57e65ac5a5f19def03c6733ce88bd8afe3affed02cc9ecadd09c5105093d0', entry_hash: 'zBwWX9zXdkL9A69bmJyiJa9hvaG9dWJULCxCGnbb2Z88TzmNs2PAVYS5uohU5gaDYEHxB9LzgoHr8Ljp6mP44eSFS8sJz' },
    { name: 'E4', next: ['E3a', 'E3b'], del: { key: LABEL_TRACK_A, timestamp: 1700000000003 }, entry_hash: 'zBwWX6MHYuh9eJqyyp52fJJs7Qsfjzbc2LEqMQgx4uUWxYwi66Pf3Mjm6Gty7rT14FHPu6UYFXRMMNfLT1uL5YaKZWJKZ' }
  ],
  label_state: [
    { track_id: LABEL_TRACK_B, label: 'mix/x', applied: true },
    { track_id: LABEL_TRACK_B, label: 'y', applied: true },
    { track_id: LABEL_TRACK_A, label: 'lifestream-radio', applied: true },
    { track_id: LABEL_TRACK_A, label: 'mix/x', applied: false }
  ],
  tie_winner: 'E3a'
} as const
