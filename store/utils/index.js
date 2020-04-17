const { CID } = require('ipfs')

const loadEntryContent = async (ipfs, e) => {
  if (!e) {
    return null
  }

  // clone
  const entry = JSON.parse(JSON.stringify(e))

  // has no content to load
  if (!entry.payload.value.content) {
    return entry
  }

  // content already loaded
  if (entry.payload.value.contentCID) {
    entry.payload.value.cid = new CID(entry.payload.value.contentCID)
    return entry
  }

  // missing needed cid info
  if (
    !entry.payload.value.content.codec ||
      !entry.payload.value.content.version ||
      !entry.payload.value.content.hash
  ) {
    throw new Error('missing cid information')
  }

  const { codec, version, hash } = entry.payload.value.content
  const cid = new CID(version, codec, Buffer.from(hash.data))

  // load content
  const dagNode = await ipfs.dag.get(cid)
  entry.payload.value.content = dagNode.value
  entry.payload.value.cid = cid
  entry.payload.value.contentCID = cid.toBaseEncodedString('base58btc')

  // convert track hash & artwork cids to strings
  const { type } = entry.payload.value
  if (type === 'track') {
    const { content } = entry.payload.value
    if (CID.isCID(content.hash)) {
      entry.payload.value.content.hash = content.hash.toBaseEncodedString('base58btc')
    }

    entry.payload.value.content.artwork = content.artwork.map((a) => {
      return CID.isCID(a) ? a.toBaseEncodedString('base58btc') : a
    })
  }

  return entry
}

module.exports = {
  loadEntryContent
}
