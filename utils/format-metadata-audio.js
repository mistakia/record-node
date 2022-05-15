const formatMetadataAudio = ({ metadata }) => {
  const result = {}
  const {
    trackInfo,
    container,
    tagTypes,
    duration,
    bitrate,
    sampleRate,
    bitsPerSample,
    tool,
    codec,
    codecProfile,
    lossless,
    numberOfChannels,
    numberOfSamples,
    audioMD5,
    chapters,
    creationTime,
    modificationTime,
    trackGain,
    trackPeakLevel,
    albumGain
  } = metadata.format

  if (tagTypes) {
    result.tagTypes = tagTypes
  }

  if (trackInfo) {
    result.trackInfo = trackInfo
  }

  if (lossless !== undefined && lossless !== null) {
    result.lossless = lossless
  }

  if (container) {
    result.container = container
  }

  if (codec) {
    result.codec = codec
  }

  if (sampleRate) {
    result.sampleRate = sampleRate
  }

  if (numberOfChannels) {
    result.numberOfChannels = numberOfChannels
  }

  if (bitrate) {
    result.bitrate = bitrate
  }

  if (codecProfile) {
    result.codecProfile = codecProfile
  }

  if (numberOfSamples) {
    result.numberOfSamples = numberOfSamples
  }

  if (duration) {
    result.duration = duration
  }

  if (bitsPerSample) {
    result.bitsPerSample = bitsPerSample
  }

  if (tool) {
    result.tool = tool
  }

  if (audioMD5) {
    result.audioMD5 = audioMD5
  }

  if (chapters) {
    result.chapters = chapters
  }

  if (creationTime) {
    result.creationTime = creationTime
  }

  if (modificationTime) {
    result.modificationTime = modificationTime
  }

  if (trackGain) {
    result.trackGain = trackGain
  }

  if (trackPeakLevel) {
    result.trackPeakLevel = trackPeakLevel
  }

  if (albumGain) {
    result.albumGain = albumGain
  }

  return result
}

module.exports = formatMetadataAudio
