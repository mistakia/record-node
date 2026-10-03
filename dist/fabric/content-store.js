// Content-addressed storage boundary (§4.6, §5.5.1). CIDs cross it as
// base58btc strings, the form entries carry (§2.1, §2.4.1). The store is
// local: nothing behind it fetches from the network.
// §5.5.1: audio blobs and artwork are imported with this profile and no
// option it sets, since an explicit importer option overrides the profile.
export const CONTENT_IMPORT_PROFILE = 'unixfs-v1-2025';
