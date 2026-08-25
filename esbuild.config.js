/**
 * esbuild.config.js -- bundles the content script (which requires the
 * ps-autobattler submodule) into dist/ for the unpacked extension.
 *
 *   node esbuild.config.js        (one-shot build)
 *   node esbuild.config.js --watch
 */
'use strict';

const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
	entryPoints: ['src/content/content-main.js'],
	bundle: true,
	outfile: 'dist/content-main.js',
	format: 'iife',
	target: 'chrome120',
	minify: false,
	sourcemap: 'inline',
	logLevel: 'info',
	// decision-core's dex-shim guards `process` behind typeof checks, but the
	// Node branch still references require('pokemon-showdown/...'); shim it out.
	define: { 'process.env.NODE_ENV': '"production"' },
	external: [],
};

(async () => {
	if (watch) {
		const ctx = await esbuild.context(options);
		await ctx.watch();
		console.log('[psab-ext] watching…');
	} else {
		await esbuild.build(options);
	}
})().catch(err => {
	console.error(err);
	process.exit(1);
});
