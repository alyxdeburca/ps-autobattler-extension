/**
 * tools/replay-timeline.js -- turn-by-turn action sequence for one side.
 * Usage: node tools/replay-timeline.js <replay-url-or-local-log> [side]
 */
'use strict';

const https = require('https');
const fs = require('fs');

function fetchText(url) {
	if (url.startsWith('/') || url.startsWith('./')) {
		return Promise.resolve(fs.readFileSync(url, 'utf8'));
	}
	return new Promise((resolve, reject) => {
		https.get(url, res => {
			if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
			let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve(b));
		}).on('error', reject);
	});
}

function normalizeId(input) {
	let s = String(input).trim();
	if (s.startsWith('/') || s.startsWith('./')) return s;
	s = s.replace(/^https?:\/\/[^/]+\//, '').replace(/\.log$/, '');
	return s.split('?')[0].split('#')[0];
}

const dexShim = require('../vendor/ps-autobattler/src/dex-shim');
dexShim.setBackend(require('../src/data/minidex'));

(async () => {
	const input = process.argv[2];
	const wantSide = (process.argv[3] || '').toLowerCase();
	const id = normalizeId(input);
	const url = id.startsWith('/') ? id :
		`https://replay.pokemonshowdown.com/${id}.log`;
	const text = await fetchText(url);
	const lines = text.split('\n');

	const names = {};
	let turn = 0;
	const actions = [];

	for (const line of lines) {
		if (!line.startsWith('|')) continue;
		const p = line.slice(1).split('|');
		switch (p[0]) {
		case 'player': names[p[1]] = p[2]; break;
		case 'turn':
			turn = parseInt(p[1], 10) || 0;
			break;
		case 'move': {
			const side = p[1].slice(0, 2);
			if (wantSide && side !== wantSide) break;
			const mv = dexShim.moveFromId(p[2].toLowerCase().replace(/[^a-z0-9]/g, ''));
			actions.push({ t: turn, side, kind: mv && mv.category === 'Status' ? 'S' : 'A',
				text: p[2] });
			break;
		}
		case 'switch': case 'drag': {
			const side = p[1].slice(0, 2);
			if (wantSide && side !== wantSide) break;
			if (p[0] === 'switch') {
				actions.push({ t: turn, side, kind: '⇄',
					text: (p[1].split(': ')[1] || p[1]) });
			}
			break;
		}
		}
	}

	console.log(`# ${id} — ${wantSide || 'both'} (${names.p1 || '?'} vs ${names.p2 || '?'})`);
	let last = null;
	for (const a of actions) {
		const same = last && last.t === a.t;
		console.log(`${same ? '    ' : `T${String(a.t).padStart(2)} `} ${a.side} ${a.kind} ${a.text}`);
		last = a;
	}
})();
