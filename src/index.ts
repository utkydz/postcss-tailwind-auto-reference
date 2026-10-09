import { existsSync } from 'node:fs'
import path from 'node:path'
import type { PluginCreator, Root } from 'postcss'

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

const toPosix = (file: string) => file.split(path.sep).join('/')

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

const tailwindAutoReference: PluginCreator<tailwindAutoReference.Options> = (
  options
) => {
  if (!options?.entry)
    throw new Error(`[${PLUGIN_NAME}] The \`entry\` option is required.`)

  const root = path.resolve(options.root ?? process.cwd())
  const entry = path.resolve(root, options.entry)

  if (!existsSync(entry))
    throw new Error(`[${PLUGIN_NAME}] Entry stylesheet not found: ${entry}`)

  const include = toMatchers(options.include ?? root, root)
  const exclude = toMatchers(options.exclude ?? /\/node_modules\//, root)

  return {
    postcssPlugin: PLUGIN_NAME,

    Once(css, { AtRule }) {
      const input = css.source?.input.file?.replace(/\?.*$/, '')
      if (!input || path.resolve(input) === entry) return

      const file = toPosix(path.resolve(input))
      if (!include.some((match) => match(file))) return
      if (exclude.some((match) => match(file))) return

      if (hasOwnTailwindContext(css)) return
      if (!options.always && !usesTailwind(css)) return

      const relative = path.relative(path.dirname(input), entry)
      let reference = toPosix(relative)

      if (!path.isAbsolute(relative) && !/^\.\.?\//.test(reference))
        reference = `./${reference}`

      css.prepend(
        new AtRule({ name: 'reference', params: JSON.stringify(reference) })
      )
    }
  }
}

tailwindAutoReference.postcss = true

export default tailwindAutoReference
