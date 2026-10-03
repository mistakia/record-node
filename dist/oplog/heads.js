// Heads (§4.3): entries no other entry names in next. refs never count.
export const compute_heads = (entries) => {
    const all = [...entries];
    const referenced = new Set(all.flatMap(({ entry }) => entry.next));
    return new Set(all.map(({ hash }) => hash).filter((hash) => !referenced.has(hash)));
};
