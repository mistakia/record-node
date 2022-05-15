const formatMetadataTags = ({ metadata, acoustid }) => {
  const result = {
    acoustid_fingerprint: acoustid.fingerprint
  }

  const { common } = metadata

  if (common.year) {
    result.year = common.year
  }

  if (common.track) {
    result.track = common.track
  }

  if (common.disk) {
    result.disk = common.disk
  }

  if (common.title) {
    result.title = common.title
  }

  if (common.artist) {
    result.artist = common.artist
  }

  if (common.artists) {
    result.artists = common.artists
  }

  if (common.albumartist) {
    result.albumartist = common.albumartist
  }

  if (common.album) {
    result.album = common.album
  }

  if (common.date) {
    result.date = common.date
  }

  if (common.originaldate) {
    result.originaldate = common.originaldate
  }

  if (common.originalyear) {
    result.originalyear = common.originalyear
  }

  if (common.comment) {
    result.comment = common.comment
  }

  if (common.genre) {
    result.genre = common.genre
  }

  if (common.composer) {
    result.composer = common.composer
  }

  if (common.lyrics) {
    result.lyrics = common.lyrics
  }

  if (common.albumsort) {
    result.albumsort = common.albumsort
  }

  if (common.titlesort) {
    result.titlesort = common.titlesort
  }

  if (common.work) {
    result.work = common.work
  }

  if (common.artistsort) {
    result.artistsort = common.artistsort
  }

  if (common.albumartistsort) {
    result.albumartistsort = common.albumartistsort
  }

  if (common.composersort) {
    result.composersort = common.composersort
  }

  if (common.lyricist) {
    result.lyricist = common.lyricist
  }

  if (common.writer) {
    result.writer = common.writer
  }

  if (common.conductor) {
    result.conductor = common.conductor
  }

  if (common.remixer) {
    result.remixer = common.remixer
  }

  if (common.arranger) {
    result.arranger = common.arranger
  }

  if (common.engineer) {
    result.engineer = common.engineer
  }

  if (common.producer) {
    result.producer = common.producer
  }

  if (common.technician) {
    result.technician = common.technician
  }

  if (common.djmixer) {
    result.djmixer = common.djmixer
  }

  if (common.mixer) {
    result.mixer = common.mixer
  }

  if (common.label) {
    result.label = common.label
  }

  if (common.grouping) {
    result.grouping = common.grouping
  }

  if (common.subtitle) {
    result.subtitle = common.subtitle
  }

  if (common.discsubtitle) {
    result.discsubtitle = common.discsubtitle
  }

  if (common.totaltracks) {
    result.totaltracks = common.totaltracks
  }

  if (common.totaldiscs) {
    result.totaldiscs = common.totaldiscs
  }

  if (common.compilation) {
    result.compilation = common.compilation
  }

  if (common.rating) {
    result.rating = common.rating
  }

  if (common.bpm) {
    result.bpm = common.bpm
  }

  if (common.mood) {
    result.mood = common.mood
  }

  if (common.media) {
    result.media = common.media
  }

  if (common.catalognumber) {
    result.catalognumber = common.catalognumber
  }

  if (common.tvShow) {
    result.tvShow = common.tvShow
  }

  if (common.tvShowSort) {
    result.tvShowSort = common.tvShowSort
  }

  if (common.tvSeason) {
    result.tvSeason = common.tvSeason
  }

  if (common.tvEpisode) {
    result.tvEpisode = common.tvEpisode
  }

  if (common.tvEpisodeId) {
    result.tvEpisodeId = common.tvEpisodeId
  }

  if (common.tvNetwork) {
    result.tvNetwork = common.tvNetwork
  }

  if (common.releasestatus) {
    result.releasestatus = common.releasestatus
  }

  if (common.releasetype) {
    result.releasetype = common.releasetype
  }

  if (common.releasecountry) {
    result.releasecountry = common.releasecountry
  }

  if (common.script) {
    result.script = common.script
  }

  if (common.language) {
    result.language = common.language
  }

  if (common.copyright) {
    result.copyright = common.copyright
  }

  if (common.license) {
    result.license = common.license
  }

  if (common.encodedby) {
    result.encodedby = common.encodedby
  }

  if (common.encodersettings) {
    result.encodersettings = common.encodersettings
  }

  if (common.gapless) {
    result.gapless = common.gapless
  }

  if (common.barcode) {
    result.barcode = common.barcode
  }

  if (common.isrc) {
    result.isrc = common.isrc
  }

  if (common.asin) {
    result.asin = common.asin
  }

  if (common.musicbrainz_recordingid) {
    result.musicbrainz_recordingid = common.musicbrainz_recordingid
  }

  if (common.musicbrainz_trackid) {
    result.musicbrainz_trackid = common.musicbrainz_trackid
  }

  if (common.musicbrainz_albumid) {
    result.musicbrainz_albumid = common.musicbrainz_albumid
  }

  if (common.musicbrainz_artistid) {
    result.musicbrainz_artistid = common.musicbrainz_artistid
  }

  if (common.musicbrainz_albumartistid) {
    result.musicbrainz_albumartistid = common.musicbrainz_albumartistid
  }

  if (common.musicbrainz_releasegroupid) {
    result.musicbrainz_releasegroupid = common.musicbrainz_releasegroupid
  }

  if (common.musicbrainz_workid) {
    result.musicbrainz_workid = common.musicbrainz_workid
  }

  if (common.musicbrainz_trmid) {
    result.musicbrainz_trmid = common.musicbrainz_trmid
  }

  if (common.musicbrainz_discid) {
    result.musicbrainz_discid = common.musicbrainz_discid
  }

  if (common.acoustid_id) {
    result.acoustid_id = common.acoustid_id
  }

  if (common.acoustid_fingerprint) {
    result.acoustid_fingerprint = common.acoustid_fingerprint
  }

  if (common.musicip_puid) {
    result.musicip_puid = common.musicip_puid
  }

  if (common.musicip_fingerprint) {
    result.musicip_fingerprint = common.musicip_fingerprint
  }

  if (common.website) {
    result.website = common.website
  }

  if (common.averageLevel) {
    result.averageLevel = common.averageLevel
  }

  if (common.peakLevel) {
    result.peakLevel = common.peakLevel
  }

  if (common.notes) {
    result.notes = common.notes
  }

  if (common.key) {
    result.key = common.key
  }

  if (common.originalalbum) {
    result.originalalbum = common.originalalbum
  }

  if (common.originalartist) {
    result.originalartist = common.originalartist
  }

  if (common.discogs_artist_id) {
    result.discogs_artist_id = common.discogs_artist_id
  }

  if (common.discogs_release_id) {
    result.discogs_release_id = common.discogs_release_id
  }

  if (common.discogs_label_id) {
    result.discogs_label_id = common.discogs_label_id
  }

  if (common.discogs_master_release_id) {
    result.discogs_master_release_id = common.discogs_master_release_id
  }

  if (common.discogs_votes) {
    result.discogs_votes = common.discogs_votes
  }

  if (common.discogs_rating) {
    result.discogs_rating = common.discogs_rating
  }

  if (common.replaygain_track_peak) {
    result.replaygain_track_peak = common.replaygain_track_peak
  }

  if (common.replaygain_track_gain) {
    result.replaygain_track_gain = common.replaygain_track_gain
  }

  if (common.replaygain_album_peak) {
    result.replaygain_album_peak = common.replaygain_album_peak
  }

  if (common.replaygain_album_gain) {
    result.replaygain_album_gain = common.replaygain_album_gain
  }

  if (common.replaygain_track_minmax) {
    result.replaygain_track_minmax = common.replaygain_track_minmax
  }

  if (common.replaygain_album_minmax) {
    result.replaygain_album_minmax = common.replaygain_album_minmax
  }

  if (common.replaygain_undo) {
    result.replaygain_undo = common.replaygain_undo
  }

  if (common.description) {
    result.description = common.description
  }

  if (common.longDescription) {
    result.longDescription = common.longDescription
  }

  if (common.category) {
    result.category = common.category
  }

  if (common.keywords) {
    result.keywords = common.keywords
  }

  if (common.movement) {
    result.movement = common.movement
  }

  if (common.movementIndex && (common.movementIndex.no || common.movementIndex.of)) {
    result.movementIndex = common.movementIndex
  }

  if (common.movementTotal) {
    result.movementTotal = common.movementTotal
  }

  if (common.podcastId) {
    result.podcastId = common.podcastId
  }

  if (common.showMovement) {
    result.showMovement = common.showMovement
  }

  if (common.stik) {
    result.stik = common.stik
  }

  return result
}

module.exports = formatMetadataTags
