const { CID } = require('ipfs-http-client')
const { base58btc } = require('multiformats/bases/base58')

const loadContentFromCID = async (ipfs, cid, type) => {
  const item = {}

  const dagNode = await ipfs.dag.get(cid)
  if (!dagNode.value) {
    return item
  }

  item.content = dagNode.value
  item.cid = CID.asCID(cid) || CID.parse(cid)
  item.contentCID = item.cid.toString(base58btc)

  // convert track hash & artwork cids to strings
  if (type === 'track') {
    if (CID.asCID(item.content.hash)) {
      item.content.hash = item.content.hash.toString(base58btc)
    }

    item.content.artwork = item.content.artwork.map((a) => {
      return CID.asCID(a) ? a.toString(base58btc) : a
    })
  }

  return item
}

module.exports = loadContentFromCID
