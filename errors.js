'use strict'

class CannotOpenLogError extends Error {
  constructor (message = 'can not open log') {
    super(message)
    this.name = 'CannotOpenLogError'
    this.code = CannotOpenLogError.code
  }
}

CannotOpenLogError.code = 'ERR_CAN_NOT_OPEN_LOG'
exports.CannotOpenLogError = CannotOpenLogError
