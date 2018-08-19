const jdenticon = require('jdenticon')

const generateAvatar = (id) => {
  const png = jdenticon.toPng(id, 100, 0.0)
  return `data:image/png;base64,${png.toString('base64')}`
}

module.exports = generateAvatar
