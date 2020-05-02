const { CID } = require('ipfs-http-client')
const loadContentFromCID = require('./load-content-from-cid')

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
  const { type } = entry.payload.value
  const cid = new CID(version, codec, Buffer.from(hash.data))
  const content = await loadContentFromCID(ipfs, cid, type)

  entry.payload.value = Object.assign(entry.payload.value, content)

  return entry
}

module.exports = loadEntryContent
