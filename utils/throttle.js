const throttle = (func, timeout) => {
  let wait = false

  return function (...args) {
    if (!wait) {
      func(...args)
      wait = true

      setTimeout(function () {
        wait = false
      }, timeout)
    }
  }
}

module.exports = throttle
