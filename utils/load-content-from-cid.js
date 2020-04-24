const { CID } = require('ipfs')

const loadContentFromCID = async (ipfs, cid, type, { localResolve = false } = {}) => {
  const item = {}

  const dagNode = await ipfs.dag.get(cid)
  if (!dagNode.value) {
    return item
  }

  item.content = dagNode.value
  item.cid = new CID(cid)
  item.contentCID = item.cid.toBaseEncodedString('base58btc')

  // convert track hash & artwork cids to strings
  if (type === 'track') {
    if (CID.isCID(item.content.hash)) {
      item.content.hash = item.content.hash.toBaseEncodedString('base58btc')
    }

    item.content.artwork = item.content.artwork.map((a) => {
      return CID.isCID(a) ? a.toBaseEncodedString('base58btc') : a
    })
  }

  return item
}

module.exports = loadContentFromCID
