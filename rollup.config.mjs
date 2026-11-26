import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { transformAsync } from '@babel/core';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const SRC = 'src';
const OUT = 'dist';
const watching = process.env.ROLLUP_WATCH === 'true';

// @rollup/plugin-babel does not support Babel 8 yet, so this small plugin calls Babel directly.
const babel = () => ({
  name: 'babel',
  async transform(code, id) {
    if (id.includes('/node_modules/') || !/\.m?js$/.test(id)) {
      return null;
    }
    const result = await transformAsync(code, { filename: id, sourceMaps: true });
    return { code: result.code, map: result.map };
  },
});

const contentHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 10);

// The plugin copies the static files and writes index.html with hashed file names.
// The hashes make sure that browsers and e-readers do not use an old cached file.
const staticSite = () => ({
  name: 'static-site',
  buildStart() {
    this.addWatchFile(join(SRC, 'index.html'));
    this.addWatchFile(join(SRC, 'styles', 'app.css'));
    readdirSync(join(SRC, 'public')).forEach((name) => this.addWatchFile(join(SRC, 'public', name)));
  },
  generateBundle(_options, bundle) {
    const css = readFileSync(join(SRC, 'styles', 'app.css'), 'utf8');
    const cssName = `app.${contentHash(css)}.css`;
    this.emitFile({ type: 'asset', fileName: cssName, source: css });

    readdirSync(join(SRC, 'public')).forEach((name) => {
      this.emitFile({ type: 'asset', fileName: name, source: readFileSync(join(SRC, 'public', name)) });
    });

    const entry = Object.values(bundle).find((file) => file.type === 'chunk' && file.isEntry);
    const html = readFileSync(join(SRC, 'index.html'), 'utf8')
      .replace('href="app.css"', `href="${cssName}"`)
      .replace('src="app.js"', `src="${entry.fileName}"`);
    this.emitFile({ type: 'asset', fileName: 'index.html', source: html });
  },
  writeBundle(_options, bundle) {
    readdirSync(OUT)
      .filter((name) => !(name in bundle))
      .forEach((name) => rmSync(join(OUT, name), { recursive: true, force: true }));
  },
});

export default {
  input: join(SRC, 'js', 'main.js'),
  onwarn(warning, warn) {
    const fromDependency = (warning.ids || []).some((id) => id.includes('node_modules'));
    if (warning.code === 'CIRCULAR_DEPENDENCY' && fromDependency) {
      return;
    }
    warn(warning);
  },
  // The dev script prints the server addresses first. Rollup must not clear them from the terminal.
  watch: { clearScreen: false },
  output: {
    dir: OUT,
    format: 'iife',
    entryFileNames: 'app.[hash].js',
    sourcemap: true,
    generatedCode: 'es5',
  },
  plugins: [
    nodeResolve({ browser: true }),
    commonjs(),
    babel(),
    staticSite(),
    !watching && terser({ ecma: 5, safari10: true, format: { comments: false } }),
  ],
};
