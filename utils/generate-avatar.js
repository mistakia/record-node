const hashicon = require('hashicon')
const { createCanvas } = typeof document === 'undefined' ? require('canvas') : {}

const generateAvatar = (id) => {
  const opts = { size: 100 }
  if (createCanvas) opts.createCanvas = createCanvas
  const icon = hashicon(id, opts)
  return icon.toDataURL()
}

module.exports = generateAvatar
