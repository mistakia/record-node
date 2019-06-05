module.exports = function info (self) {
  const getOrbitdb = () => {
    return {
      address: self._log.address.toString(),
      publicKey: self._log.identity.publicKey
    }
  }

  const getId = async () => {
    const id = await self._ipfs.id()
    return id
  }

  const getPeers = async () => {
    const peerInfos = await self._ipfs.swarm.peers()
    const peers = peerInfos.map((peerInfo) => {
      return {
        id: peerInfo.peer.toB58String(),
        address: peerInfo.addr.toString()
      }
    })
    return peers
  }

  const getSubs = async () => {
    const subInfos = await self._ipfs.pubsub.ls()
    let subs = {}

    for (const subInfo of subInfos) {
      const peerIds = await self._ipfs.pubsub.peers(subInfo)
      subs[subInfo] = peerIds
    }

    return subs
  }

  const getInfo = async () => {
    const [
      subs,
      ipfs,
      peers,
      bitswap,
      repo
    ] = await Promise.all([
      getSubs(),
      getId(),
      getPeers(),
      self._ipfs.bitswap.stat(),
      self._ipfs.repo.stat({ human: true })
    ])
    const state = self._ipfs.state.state()
    const orbitdb = getOrbitdb()
    return {
      subs,
      ipfs,
      peers,
      state,
      orbitdb,
      bitswap,
      repo
    }
  }

  return getInfo
}
