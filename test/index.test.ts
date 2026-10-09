import path from 'node:path'
import tailwindcss from '@tailwindcss/postcss'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import autoReference from '../src/index.ts'

type Options = autoReference.Options

const root = path.join(import.meta.dirname, 'fixtures')
const entry = 'styles/main.css'

const run = async (
  css: string,
  from: string | undefined,
  options: Partial<Options> = {}
) =>
  (
    await postcss([autoReference({ entry, root, ...options })]).process(css, {
      from: from && path.join(root, from)
    })
  ).css

const APPLY = '.btn { @apply flex; }'

describe('injection', () => {
  it('adds a relative reference to a file that uses @apply', async () => {
    expect(await run(APPLY, 'components/button.module.css')).toBe(
      `@reference "../styles/main.css";\n${APPLY}`
    )
  })

  it('prefixes same-directory references with ./', async () => {
    expect(await run(APPLY, 'styles/button.module.css')).toMatch(
      /^@reference "\.\/main\.css";/
    )
  })

  it.each([
    ['@variant', '.a { @variant hover { color: red; } }'],
    ['theme()', '.a { color: theme(--color-red-500); }'],
    ['--theme()', '.a { color: --theme(--color-red-500); }'],
    ['--spacing()', '.a { margin: --spacing(4); }'],
    ['--alpha()', '.a { color: --alpha(red / 50%); }'],
    [
      'functions in at-rule params',
      '@media (width >= theme(--breakpoint-md)) {}'
    ]
  ])('detects %s', async (_, css) => {
    expect(await run(css, 'components/a.module.css')).toMatch(/^@reference /)
  })

  it('strips query strings from the file name', async () => {
    expect(
      await run(APPLY, 'components/Button.vue?vue&type=style&index=0&lang.css')
    ).toMatch(/^@reference "\.\.\/styles\/main\.css";/)
  })
})

describe('skips', () => {
  it('files that use no Tailwind feature', async () => {
    const css = '.a { color: red; }'
    expect(await run(css, 'components/a.module.css')).toBe(css)
  })

  it('unless `always` is set', async () => {
    expect(
      await run('.a { color: red; }', 'components/a.module.css', {
        always: true
      })
    ).toMatch(/^@reference /)
  })

  it('the entry itself', async () => {
    expect(await run(APPLY, entry)).toBe(APPLY)
  })

  it.each([
    ['@reference', `@reference "./other.css";\n${APPLY}`],
    ['@import tailwindcss', `@import 'tailwindcss';\n${APPLY}`],
    ['@import tailwindcss/*', `@import "tailwindcss/utilities";\n${APPLY}`],
    ['@tailwind', `@tailwind utilities;\n${APPLY}`]
  ])('files with their own %s', async (_, css) => {
    expect(await run(css, 'components/a.module.css')).toBe(css)
  })

  it('css without a source file', async () => {
    expect(await run(APPLY, undefined)).toBe(APPLY)
  })

  it('node_modules by default', async () => {
    expect(await run(APPLY, 'node_modules/lib/a.css')).toBe(APPLY)
  })

  it('files outside root', async () => {
    expect(await run(APPLY, '../outside/a.module.css')).toBe(APPLY)
  })
})

describe('filters', () => {
  it('include accepts a directory', async () => {
    expect(
      await run(APPLY, 'components/a.module.css', { include: 'app' })
    ).toBe(APPLY)
    expect(await run(APPLY, 'app/a.module.css', { include: 'app' })).toMatch(
      /^@reference /
    )
  })

  it('include accepts a RegExp', async () => {
    const include = /\.module\.css$/g

    expect(await run(APPLY, 'components/a.css', { include })).toBe(APPLY)
    expect(await run(APPLY, 'components/a.module.css', { include })).toMatch(
      /^@reference /
    )
    expect(await run(APPLY, 'components/b.module.css', { include })).toMatch(
      /^@reference /
    )
  })

  it('exclude accepts a function and replaces the default', async () => {
    const exclude = (file: string) => file.endsWith('/legacy.css')

    expect(await run(APPLY, 'components/legacy.css', { exclude })).toBe(APPLY)
    expect(await run(APPLY, 'node_modules/lib/a.css', { exclude })).toMatch(
      /^@reference /
    )
  })

  it('accepts arrays', async () => {
    expect(
      await run(APPLY, 'components/a.module.css', {
        exclude: ['app', /components/]
      })
    ).toBe(APPLY)
  })
})

describe('options', () => {
  it('requires entry', () => {
    expect(() => autoReference({} as Options)).toThrow(/`entry` option/)
  })

  it('fails fast when entry is missing', () => {
    expect(() => autoReference({ entry: 'missing.css', root })).toThrow(
      /Entry stylesheet not found/
    )
  })
})

describe('with @tailwindcss/postcss', () => {
  const compile = (plugins: postcss.AcceptedPlugin[]) =>
    postcss([...plugins, tailwindcss({ base: root })]).process(
      '.btn { @apply flex text-red-500; }',
      { from: path.join(root, 'components/button.module.css') }
    )

  it('fails without the plugin', async () => {
    await expect(compile([])).rejects.toThrow(/unknown utility class/)
  })

  it('compiles @apply with the plugin', async () => {
    const { css } = await compile([autoReference({ entry, root })])

    expect(css).toContain('display: flex')
    expect(css).toContain('color: var(--color-red-500')
    expect(css).not.toContain('@reference')
  })
})
