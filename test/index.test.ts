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

describe('Turbopack file names', () => {
  it.each([
    ['components/a.module.scss.module.css', /\.module\.scss$/],
    ['components/a.scss.css', /components\/a\.scss$/],
    ['components/a.module.less.module.css', /\.module\.less$/]
  ])('filters see %s by its real name', async (from, include) => {
    expect(await run(APPLY, from, { include })).toMatch(
      /^@reference "\.\.\/styles\/main\.css";/
    )
  })

  it('keeps plain .css names', async () => {
    expect(
      await run(APPLY, 'components/a.module.css', { include: /\.css$/ })
    ).toMatch(/^@reference /)
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

describe('@property fallback in CSS modules', () => {
  const POLYFILL = /\*,\s*:{1,2}before,\s*:{1,2}after,\s*::backdrop/

  const compile = (
    plugins: postcss.AcceptedPlugin[],
    from: string,
    css = '.btn { @apply font-semibold shadow-md; }',
    optimize = false
  ) =>
    postcss([...plugins, tailwindcss({ base: root, optimize })])
      .process(css, { from: path.join(root, from) })
      .then((result) => result.css)

  it('is emitted by Tailwind for .module.scss', async () => {
    const css = await compile(
      [],
      'components/button.module.scss',
      `@reference "../styles/main.css";\n.btn { @apply font-semibold; }`
    )

    expect(css).toMatch(POLYFILL)
  })

  it.each([false, true])(
    'is removed from .module.scss (optimize: %s)',
    async (optimize) => {
      const css = await compile(
        [autoReference({ entry, root })],
        'components/button.module.scss',
        undefined,
        optimize
      )

      expect(css).not.toMatch(POLYFILL)
      expect(css).not.toMatch(/:root,\s*:host/)
      expect(css).not.toContain('@layer properties')
      expect(css).toMatch(/font-weight:\s*var\(--font-weight-semibold/)
      expect(css).toContain('@property --tw-font-weight')
    }
  )

  it('is removed when the module has its own @reference', async () => {
    const css = await compile(
      [autoReference({ entry, root })],
      'components/button.module.sass',
      `@reference "../styles/main.css";\n.btn { @apply font-semibold; }`
    )

    expect(css).not.toMatch(POLYFILL)
  })

  it('is left to Tailwind for Turbopack module names', async () => {
    const css = await compile(
      [autoReference({ entry, root })],
      'components/button.module.scss.module.css'
    )

    expect(css).not.toMatch(POLYFILL)
    expect(css).toMatch(/font-weight:\s*var\(--font-weight-semibold/)
  })

  it('is kept outside CSS modules', async () => {
    const css = await compile(
      [autoReference({ entry, root })],
      'components/button.scss'
    )

    expect(css).toMatch(POLYFILL)
  })

  it('is kept in excluded files', async () => {
    const css = await compile(
      [autoReference({ entry, root, exclude: 'components' })],
      'components/button.module.scss',
      `@reference "../styles/main.css";\n.btn { @apply font-semibold; }`
    )

    expect(css).toMatch(POLYFILL)
  })

  it('keeps user-written properties layers', async () => {
    const css = await compile(
      [autoReference({ entry, root })],
      'components/button.module.scss',
      '@layer properties { .keep { color: red; } }\n.btn { @apply font-semibold; }'
    )

    expect(css).not.toMatch(POLYFILL)
    expect(css).toMatch(/@layer properties\s*{\s*\.keep/)
  })
})
