# postcss-tailwind-auto-reference

Adds Tailwind CSS v4 `@reference` to your CSS / SCSS modules automatically, so `@apply` just works.

## Why

Tailwind v4 compiles every stylesheet on its own. A CSS module that uses `@apply`, `@variant` or `theme()` has to point at your main stylesheet first:

```css
@reference '../../assets/styles/main.css';

.button {
  @apply rounded-lg bg-blue-500 px-4 py-2;
}
```

Writing that relative path in every module is tedious, it breaks when files move, and Tailwind's resolver doesn't understand tsconfig path aliases. This plugin adds the line for you.

## Install

```sh
npm install --save-dev postcss-tailwind-auto-reference
```

## Usage

Add it **before** `@tailwindcss/postcss`.

### Next.js

```js
// postcss.config.mjs
const config = {
  plugins: {
    'postcss-tailwind-auto-reference': { entry: 'src/app/globals.css' },
    '@tailwindcss/postcss': {}
  }
}

export default config
```

Works with both Turbopack and webpack (`next build --webpack`).

### Vite and other PostCSS setups

```js
// postcss.config.mjs
import tailwindcss from '@tailwindcss/postcss'
import autoReference from 'postcss-tailwind-auto-reference'

export default {
  plugins: [autoReference({ entry: 'src/styles/main.css' }), tailwindcss()]
}
```

With Vite, use `@tailwindcss/postcss` as above instead of `@tailwindcss/vite`. The Vite plugin compiles CSS before PostCSS runs, so the reference would arrive too late.

## Options

| Option    | Type                         | Default              | Description                                                                                |
| --------- | ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `entry`   | `string`                     | required             | Your Tailwind entry stylesheet (the one with `@import 'tailwindcss'`), relative to `root`. |
| `root`    | `string`                     | `process.cwd()`      | Base directory for `entry` and string filters. Files outside it are never touched.         |
| `include` | `FileFilter \| FileFilter[]` | `root`               | Only matching files get a reference.                                                       |
| `exclude` | `FileFilter \| FileFilter[]` | `/\/node_modules\//` | Matching files never get a reference. Passing it replaces the default.                     |
| `always`  | `boolean`                    | `false`              | Add the reference even when the file uses no Tailwind feature.                             |

A `FileFilter` is one of:

- a `string`: a directory or file, relative to `root` (`'src/components'`)
- a `RegExp`, tested against the absolute path with forward slashes (`/\.module\.s?css$/`)
- a function `(file: string) => boolean` that receives the same path

Filters see the real source file. Turbopack hands Sass output to PostCSS as `a.module.scss.module.css`, but `/\.module\.scss$/` still matches it.

## How it decides

A file gets `@reference "<relative path to entry>";` prepended when:

1. it has a source path (query strings such as `?vue&type=style` are ignored) that matches `include` and not `exclude`,
2. it isn't the entry itself,
3. it doesn't already have `@reference`, `@import 'tailwindcss'` (or a `tailwindcss/*` subpath) or `@tailwind`,
4. it uses `@apply`, `@variant`, `theme()`, `--theme()`, `--spacing()` or `--alpha()`, or `always` is `true`.

`@reference` never outputs the entry's CSS, so modules don't duplicate your global styles.

## Sass

`.module.scss` files work: bundlers run Sass first and PostCSS after it, so the reference is added to Sass's output and doesn't clash with `@use`.

Two Tailwind v4 + Sass gotchas, unrelated to this plugin:

- `@apply flex #{!important}` fails. Write `@apply flex!` instead.
- Don't nest `@variant` inside SCSS rules. Sass hoists it and the output is wrong. Use `&:hover { ... }` or `@apply hover:...`.

## `.module.scss` and "Selector is not pure"

Utilities that use registered `--tw-*` properties (`font-semibold`, `shadow-*`, `ring-*`, transforms, gradients, …) make Tailwind emit an `@property` fallback for older browsers: a global `*, ::before, ::after, ::backdrop` rule. `@tailwindcss/postcss` leaves it out for `.module.css` files, but only checks that extension, so `.module.scss`, `.module.sass` and `.module.less` still get it, and pure CSS Modules (e.g. Next.js webpack builds) fail with:

```
Selector "*,:before,:after,::backdrop" is not pure
```

For CSS modules that `include`/`exclude` allow, this plugin removes that fallback after Tailwind runs. The output then matches what Tailwind produces for `.module.css`. Your entry stylesheet and global stylesheets keep it.

Turbopack never hits this: it renames Sass output to `.module.css`, so Tailwind handles it there.

## Compatibility

Tested with:

- Tailwind CSS 4.3 and PostCSS 8.5
- Next.js 16.4 (Turbopack and webpack)
- Vite 8.3 (with `@tailwindcss/postcss`)
- Node.js 20, 22 and 24

## TypeScript

Types are included. Option types live on the default export:

```ts
import autoReference from 'postcss-tailwind-auto-reference'

const options: autoReference.Options = { entry: 'src/styles/main.css' }
```

## Development

```sh
bun install
bun run test       # vitest
bun run typecheck
bun run build      # tsdown → dist/
bun run lint:pkg   # publint + arethetypeswrong
```

## License

MIT
