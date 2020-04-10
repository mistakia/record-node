const { CID } = require('ipfs')

const loadEntryContent = async (ipfs, entry) => {
  if (!entry) {
    return null
  }

  if (typeof entry.payload.value.content === 'string') {
    entry.payload.value.content = new CID(entry.payload.value.content)
  }

  // convert entry content cid to value of dagNode
  if (CID.isCID(entry.payload.value.content)) {
    entry.payload.value.cid = entry.payload.value.content
    entry.payload.value.contentCID = entry.payload.value.content.toBaseEncodedString('base58btc')
    const dagNode = await ipfs.dag.get(entry.payload.value.content, { localResolve: true })
    entry.payload.value.content = dagNode.value
  }

  const { type } = entry.payload.value
  if (type === 'track') {
    const { content } = entry.payload.value
    if (CID.isCID(content.hash)) {
      entry.payload.value.content.hash = content.hash.toBaseEncodedString('base58btc')
    }

    // convert artwork cids to string
    entry.payload.value.content.artwork = content.artwork.map((a) => {
      return CID.isCID(a) ? a.toBaseEncodedString('base58btc') : a
    })
  }

  return entry
}

module.exports = {
  loadEntryContent
}
