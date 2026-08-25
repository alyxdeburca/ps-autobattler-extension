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
for (const rel of ['manifest.json', 'dist', 'src/content/overlay.css']) {
	const src = path.join(root, rel);
	const dest = path.join(out, rel);
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	if (fs.statSync(src).isDirectory()) {
		fs.cpSync(src, dest, { recursive: true });
	} else {
		fs.cpSync(src, dest);
	}
}

// 3. Sanity: every file the manifest mentions must exist in the stage.
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
const referenced = [];
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
