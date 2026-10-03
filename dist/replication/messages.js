// Network message bodies (§5.3.2, §5.4.1) as pure JSON codecs. Publishing,
// size enforcement, and coalescing belong to the replication engine.
export const encode_heads_message = ({ heads }) => JSON.stringify({ type: 'heads', heads });
// A LoadedAboutEntry is the signed about entry with entry.hash alongside and
// the about payload inlined in place of the envelope content CID. It is a hint
// only; receivers re-fetch the canonical entry by hash to authenticate it.
export const build_loaded_about_entry = ({ hash, entry, about_content }) => {
    const { op, key, value } = entry.payload;
    return {
        hash,
        id: entry.id,
        payload: {
            op,
            key,
            value: { id: value.id, timestamp: value.timestamp, v: value.v, type: value.type, content: about_content }
        },
        next: entry.next,
        refs: entry.refs,
        v: entry.v,
        clock: entry.clock,
        key: entry.key,
        sig: entry.sig
    };
};
