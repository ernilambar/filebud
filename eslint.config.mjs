import { globalIgnores } from 'eslint/config'
import neostandard from 'neostandard'

export default [
  ...neostandard({ env: ['browser'] }),
  globalIgnores(['public/editor/']),
]
