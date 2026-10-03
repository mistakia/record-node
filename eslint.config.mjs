import neostandard from 'neostandard'

export default [
  // Vendored byte-identical from repository/active/base; lint it there.
  { ignores: ['cli/check-lockfile-age.mjs'] },
  ...neostandard({ ts: true }),
  {
    // Project convention is snake_case for variables and functions.
    rules: { camelcase: 'off' }
  }
]
