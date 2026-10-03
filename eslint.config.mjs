import neostandard from 'neostandard'

export default [
  ...neostandard({ ts: true }),
  {
    // Project convention is snake_case for variables and functions.
    rules: { camelcase: 'off' }
  }
]
