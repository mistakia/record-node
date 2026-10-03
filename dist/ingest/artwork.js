// Artwork upload (§6.3.3, §6.4.1 steps 8 and 11).
// Imports each picture with the §5.5.1 profile, in source order, and returns
// the CIDs. No artwork yields [], never a missing field.
export const upload_artwork = async ({ pictures, content_store }) => {
    const cids = [];
    for (const { data } of pictures)
        cids.push(await content_store.import_blob(data));
    return cids;
};
