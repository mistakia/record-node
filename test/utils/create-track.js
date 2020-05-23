module.exports = (id, { title, artist, album, bpm = null, duration = 30, bitrate = 192000 } = {}) => ({
  hash: 'bafybeig6xv5nwphfmvcnektpnojts33jqcuam7bmye2pb54adnrtccjlsu',
  tags: {
    title: title || id,
    artist: artist || null,
    artists: null,
    albumartist: null,
    album: album || null,
    remixer: null,
    bpm: bpm,
    acoustid_fingerprint: id
  },
  audio: {
    duration: duration,
    bitrate: bitrate
  },
  resolver: [],
  artwork: []
})
