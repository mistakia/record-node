module.exports = function info (self) {
  const getSubs = async () => {
    const subInfos = await self._ipfs.pubsub.ls()
    let subs = {}

    for (const subInfo of subInfos) {
      const peerIds = await self._ipfs.pubsub.peers(subInfo)
      subs[subInfo] = peerIds
    }

    return subs
  }

  return {
    _init: () => {
      // TODO emit event on ipfs peer join
      // TODO emit event on ipfs peer leave
    },
    get: async () => {
      const subs = await getSubs()

      return {
        subs,
        bw: self._bwStats,
        repo: self._repoStats
      }
    }
  }
}
