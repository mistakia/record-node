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

class InvalidEntryTypeError extends Error {
  constructor (message = 'invalid entry type') {
    super(message)
    this.name = 'InvalidEntryTypeError'
    this.code = InvalidEntryTypeError.code
  }
}

InvalidEntryTypeError.code = 'INVALID_ENTRY_TYPE'
exports.InvalidEntryTypeError = InvalidEntryTypeError

class DuplicateEntryError extends Error {
  constructor (message = 'duplicate entry') {
    super(message)
    this.name = 'DuplicateEntryError'
    this.code = DuplicateEntryError.code
  }
}

DuplicateEntryError.code = 'DUPLICATE_ENTRY'
exports.DuplicateEntryError = DuplicateEntryError
