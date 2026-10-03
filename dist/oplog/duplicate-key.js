// The §2.10 duplicate_key tuple: (library_address, envelope.id,
// envelope.content, sorted(envelope.tags)), a missing tags field counting as [].
export const duplicate_key = ({ library_address, envelope }) => JSON.stringify([
    library_address,
    envelope.id,
    envelope.content,
    [...(envelope.tags ?? [])].sort()
]);
