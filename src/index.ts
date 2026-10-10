import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AtRule, ChildNode, PluginCreator, Root } from 'postcss'

// Types live on the plugin's namespace so the CJS build can use `export =`.
declare namespace tailwindAutoReference {
  /**
   * A directory or file path (relative to `root`), a RegExp tested against the
   * absolute posix path, or a function that receives the absolute posix path.
   */
  type FileFilter = string | RegExp | ((file: string) => boolean)

  interface Options {
    /** Tailwind entry stylesheet (the one with `@import 'tailwindcss'`), relative to `root`. */
    entry: string
    /** Base directory for `entry` and string filters. Defaults to `process.cwd()`. */
    root?: string
    /** Only matching files get a reference. Defaults to every file under `root`. */
    include?: FileFilter | FileFilter[]
    /** Matching files never get a reference. Defaults to `node_modules`. */
    exclude?: FileFilter | FileFilter[]
    /** Add the reference even when the file uses no Tailwind feature. Defaults to `false`. */
    always?: boolean
  }
}

type FileFilter = tailwindAutoReference.FileFilter

const PLUGIN_NAME = 'postcss-tailwind-auto-reference'

const TAILWIND_AT_RULES = new Set(['apply', 'variant'])
const TAILWIND_FUNCTION = /(?:^|[^\w-])(?:theme|--theme|--spacing|--alpha)\(/
const TAILWIND_IMPORT = /^(?:url\()?\s*['"]tailwindcss(?:\/[^'"]*)?['"]/

// Turbopack hands Sass/Less output to PostCSS as `a.scss.css` and
// `a.module.scss.module.css`. Filters should see the real file name.
const TURBOPACK_SUFFIX = /(\.(?:s[ac]ss|less|styl(?:us)?))(?:\.module)?\.css$/

// @tailwindcss/postcss skips its `@property` fallback only for `.module.css`.
// Other CSS modules (`.module.scss`, ...) get global `*` / `:root` rules that
// pure CSS Modules (Next.js webpack) reject.
const CSS_MODULE = /\.module\.[^./]+$/
const POLYFILL_SELECTORS = new Set([
  '*,:before,:after,::backdrop',
  ':root,:host'
])

// Bundlers and `process.cwd()` may disagree on the Windows drive letter case.
const toPosix = (file: string) =>
  file
    .split(path.sep)
    .join('/')
    .replace(/^[a-z]:/, (drive) => drive.toUpperCase())

const toMatchers = (
  filters: FileFilter | FileFilter[],
  root: string
): ((file: string) => boolean)[] =>
  (Array.isArray(filters) ? filters : [filters]).map((filter) => {
    if (typeof filter === 'function') return filter

    if (filter instanceof RegExp)
      return (file) => {
        filter.lastIndex = 0
        return filter.test(file)
      }

    const target = toPosix(path.resolve(root, filter))
    return (file) => file === target || file.startsWith(`${target}/`)
  })

const hasOwnTailwindContext = (css: Root) => {
  let found = false

  css.walkAtRules((rule) => {
    if (
      rule.name === 'reference' ||
      rule.name === 'tailwind' ||
      (rule.name === 'import' && TAILWIND_IMPORT.test(rule.params))
    ) {
      found = true
      return false
    }
  })

  return found
}

const usesTailwind = (css: Root) => {
  let found = false

  css.walk((node) => {
    if (
      (node.type === 'atrule' &&
        (TAILWIND_AT_RULES.has(node.name) ||
          TAILWIND_FUNCTION.test(node.params))) ||
      (node.type === 'decl' && TAILWIND_FUNCTION.test(node.value))
    ) {
      found = true
      return false
    }
  })

  return found
}

const isPolyfillRule = (node: ChildNode) =>
  node.type === 'rule' &&
  POLYFILL_SELECTORS.has(
    node.selector.replace(/\s+/g, '').replace(/::(before|after)/g, ':$1')
  )

const isPolyfillLayer = (layer: AtRule) =>
  !!layer.nodes?.length &&
  layer.nodes.every(
    (node) =>
      node.type === 'atrule' &&
      node.name === 'supports' &&
      !!node.nodes?.length &&
      node.nodes.every(isPolyfillRule)
  )

const removePropertyPolyfill = (css: Root) => {
  const layers: AtRule[] = []

  css.walkAtRules('layer', (layer) => {
    if (layer.params === 'properties') layers.push(layer)
  })

  if (!layers.some(isPolyfillLayer)) return

  for (const layer of layers)
    if (!layer.nodes || isPolyfillLayer(layer)) layer.remove()
}

const tailwindAutoReference: PluginCreator<tailwindAutoReference.Options> = (
  options
) => {
  if (!options?.entry)
    throw new Error(`[${PLUGIN_NAME}] The \`entry\` option is required.`)

  const root = path.resolve(options.root ?? process.cwd())
  const entry = path.resolve(root, options.entry)

  if (!existsSync(entry))
    throw new Error(`[${PLUGIN_NAME}] Entry stylesheet not found: ${entry}`)

  const entryPosix = toPosix(entry)

  const include = toMatchers(options.include ?? root, root)
  const exclude = toMatchers(options.exclude ?? /\/node_modules\//, root)

  return {
    postcssPlugin: PLUGIN_NAME,

    prepare() {
      let input: string | undefined

      return {
        Once(css) {
          const file = css.source?.input.file
            ?.replace(/\?.*$/, '')
            .replace(TURBOPACK_SUFFIX, '$1')
          if (!file) return

          const posix = toPosix(path.resolve(file))
          if (posix === entryPosix) return
          if (!include.some((match) => match(posix))) return
          if (exclude.some((match) => match(posix))) return

          input = file

          if (hasOwnTailwindContext(css)) return
          if (!options.always && !usesTailwind(css)) return

          const relative = path.relative(path.dirname(file), entry)
          let reference = toPosix(relative)

          if (!path.isAbsolute(relative) && !/^\.\.?\//.test(reference))
            reference = `./${reference}`

          css.prepend({ name: 'reference', params: JSON.stringify(reference) })
        },

        OnceExit(css, { result }) {
          if (
            input &&
            CSS_MODULE.test(input) &&
            !result.opts.from?.endsWith('.module.css')
          )
            removePropertyPolyfill(css)
        }
      }
    }
  }
}

tailwindAutoReference.postcss = true

export default tailwindAutoReference
