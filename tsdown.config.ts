import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  entry: 'src/index.ts',
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node20',
  dts: true
}

export default config
