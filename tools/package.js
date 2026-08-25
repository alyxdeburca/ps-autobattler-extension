/**
 * tools/package.js
 *
 * Assembles a pristine, Chrome-loadable extension folder from repo sources:
 *
 *   dist-package/
 *     manifest.json
 *     dist/inject-bridge.js      (MAIN-world bridge)
 *     dist/content-main.js       (esbuild bundle incl. decision core)
 *     src/content/overlay.css    (declared in manifest)
 *
 * Usage:
 *   node tools/package.js              # build + stage into dist-package/
 *   node tools/package.js --out DIR    # custom staging dir
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = (() => {
	const i = process.argv.indexOf('--out');
	return path.resolve(root, i >= 0 ? process.argv[i + 1] : 'dist-package');
})();

function run(cmd) {
	execSync(cmd, { cwd: root, stdio: 'inherit' });
}

// 1. Fresh build of content-main.js + copy of inject-bridge.js
run('npm run build');

// 2. Stage only what manifest.json references.
fs.rmSync(out, { recursive: true, force: true });
for (const [srcRel, destRel] of [
	['manifest.json', 'manifest.json'],
	['dist', 'dist'],
	['src/popup', 'popup'],
]) {
	const src = path.join(root, srcRel);
	const dest = path.join(out, destRel);
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	if (fs.statSync(src).isDirectory()) {
		fs.cpSync(src, dest, { recursive: true });
		// popup scripts are bundled by esbuild into dist/; the page loads them
		// via ../dist/. Don't ship raw copies alongside the sources.
		if (destRel === 'popup') {
			for (const f of fs.readdirSync(dest)) {
				if (f.endsWith('.js')) fs.rmSync(path.join(dest, f));
			}
		}
	} else {
		fs.cpSync(src, dest);
	}
}

// 3. Sanity: every file the manifest mentions must exist in the stage.
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
const referenced = [];
if (manifest.action && manifest.action.default_popup) {
	referenced.push(manifest.action.default_popup);
}
for (const cs of manifest.content_scripts || []) {
	for (const f of [...(cs.js || []), ...(cs.css || [])]) referenced.push(f);
}
for (const r of manifest.web_accessible_resources || []) {
	for (const f of r.resources || []) referenced.push(f);
}
const missing = referenced.filter(rel => !fs.existsSync(path.join(out, rel)));
if (missing.length) {
	console.error('PACKAGING ERROR - missing files:', missing);
	process.exit(1);
}

console.log(`staged ${referenced.length} manifest-referenced files -> ${out}`);
