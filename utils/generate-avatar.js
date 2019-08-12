const hashicon = require('hashicon')

const generateAvatar = (id) => {
  const canvas = hashicon(id, 100)
  return canvas.toDataURL()
}

module.exports = generateAvatar
