/**
 * tools/analyze-replay.js -- post-battle analyzer for replay links.
 *
 * Fetches a Showdown replay log, reconstructs both sides' play, and prints
 * comparison metrics: winner/turns, damage dealt, KOs, switch counts,
 * status-move usage, tera usage, and per-player move tempo profile.
 *
 * Usage: node tools/analyze-replay.js <replay-url-or-id> [<url2> ...]
 * Accepts full URLs (replay.pokemonshowdown.com/...) or bare ids.
 */
'use strict';

const https = require('https');
const fs = require('fs');

function fetchText(url) {
	// Local paths (absolute or ./relative) are read straight from disk --
	// used by the parser's own tests.
	if (url.startsWith('/') || url.startsWith('./')) {
		return Promise.resolve(fs.readFileSync(url, 'utf8'));
	}
	return new Promise((resolve, reject) => {
		https.get(url, res => {
			if (res.statusCode !== 200) {
				res.resume();
				reject(new Error(`HTTP ${res.statusCode} for ${url}`));
				return;
			}
			let buf = '';
			res.on('data', d => { buf += d; });
			res.on('end', () => resolve(buf));
		}).on('error', reject);
	});
}

function normalizeId(input) {
	let s = String(input).trim();
	if (s.startsWith('/') || s.startsWith('./')) return s; // local log file
	s = s.replace(/^https?:\/\/[^/]+\//, '').replace(/\.log$/, '').replace(/\.json$/, '');
	s = s.split('?')[0].split('#')[0];
	if (!s.startsWith('battle-')) s = `battle-${s}`;
	return s;
}

function analyze(logText, label) {
	const players = {
		p1: { name: 'p1', switches: 0, statusMoves: 0, attacks: 0, tera: null,
			dmgDealtApprox: 0, monsSeen: new Map(), koScored: 0 },
		p2: { name: 'p2', switches: 0, statusMoves: 0, attacks: 0, tera: null,
			dmgDealtApprox: 0, monsSeen: new Map(), koScored: 0 },
	};
	const hp = {};        // ident -> {cur,max}
	const active = {};    // side -> ident
	const dexShim = require('../vendor/ps-autobattler/src/dex-shim');
	dexShim.setBackend(require('../src/data/minidex'));
	const dex = dexShim;

	let turn = 0;
	let winner = '';
	const lines = logText.split('\n');

	// STRICT ALLOWLIST: only genuine battle-protocol commands are parsed.
	// Player chat (|c|, |chat|, |chatmsg|, |pm|, ...), join/leave notices,
	// HTML boxes etc. are ignored outright -- even if someone types
	// "|move|p1a: Foo|Fake Out" into chat, cmd === 'c'/'chat' and it never
	// reaches a case below. Split lines are resolved to their public half.
	const PARSED = new Set(['player', 'turn', 'win', 'switch', 'drag', 'move',
		'-damage', '-faint', '-terastallize']);

	for (let li = 0; li < lines.length; li++) {
		if (!lines[li].startsWith('|')) continue;
		const parts = lines[li].slice(1).split('|');
		// |split|pN -> next line is SECRET for that side, then PUBLIC; use public.
		if (parts[0] === 'split') { li += 1; continue; }
		if (!PARSED.has(parts[0])) continue;
		switch (parts[0]) {
		case 'player':
			if (players[parts[1]]) players[parts[1]].name = parts[2] || parts[1];
			break;
		case 'turn':
			turn = parseInt(parts[1], 10) || turn;
			break;
		case 'win': winner = parts[1] || ''; break;
		case 'switch': case 'drag': {
			const [, ident, details, cond] = parts;
			const side = ident.slice(0, 2);
			active[side] = ident;
			hp[ident] = parseCond(cond);
			players[side].monsSeen.set(ident, details);
			if (parts[0] === 'switch') players[side].switches++;
			break;
		}
		case 'move': {
			const [, ident, moveName] = parts;
			const side = ident.slice(0, 2);
			const mv = dex.moveFromId(moveName.toLowerCase().replace(/[^a-z0-9]/g, ''));
			if (!mv) break;
			if (mv.category === 'Status') players[side].statusMoves++;
			else players[side].attacks++;
			break;
		}
		case '-damage': {
			const [, ident, cond] = parts;
			const prev = hp[ident] || { cur: null };
			const next = parseCond(cond);
			hp[ident] = next;
			if (prev.cur != null && next.cur != null && next.cur < prev.cur) {
				const victimSide = ident.slice(0, 2);
				const dealerSide = victimSide === 'p1' ? 'p2' : 'p1';
				const maxRef = next.max || prev.max;
				if (maxRef) {
					players[dealerSide].dmgDealtApprox += (prev.cur - next.cur) /
						maxRef * 100;
				}
			}
			break;
		}
		case '-faint': {
			const ident = parts[1];
			const victimSide = ident.slice(0, 2);
			players[victimSide === 'p1' ? 'p2' : 'p1'].koScored++;
			break;
		}
		case '-terastallize': {
			const side = parts[1].slice(0, 2);
			players[side].tera = parts[2];
			break;
		}
		default: break;
		}
	}

	console.log(`\n===== ${label} =====`);
	console.log(`turns: ${turn} | winner: ${winner || '(tie/unknown)'}`);
	for (const side of ['p1', 'p2']) {
		const p = players[side];
		console.log(`${side} (${p.name}):` +
			` attacks=${p.attacks}` +
			` status=${p.statusMoves}` +
			` switches=${p.switches}` +
			` KOs=${p.koScored}` +
			` dmg%≈${p.dmgDealtApprox.toFixed(0)}` +
			` tera=${p.tera || '-'}`);
	}
	return { turn, winner, players };
}

function parseCond(cond) {
	const fnt = cond.endsWith(' fnt');
	const body = fnt ? cond.slice(0, -4) : cond;
	const [hpPart] = body.split(' ');
	if (hpPart.includes('/')) {
		const [c, m] = hpPart.split('/').map(Number);
		return { cur: c, max: m, fnt };
	}
	const v = Number(hpPart); // percent view (foe)
	return { cur: v, max: v ? 100 : 0, fnt };
}

(async () => {
	const args = process.argv.slice(2);
	if (!args.length) {
		console.error('usage: node tools/analyze-replay.js <replay-url-or-id> [...]');
		process.exit(1);
	}
	const results = [];
	for (const arg of args) {
		const id = normalizeId(arg);
		const isLocal = id.startsWith('/') || id.startsWith('./');
		const url = isLocal ? id :
			`https://replay.pokemonshowdown.com/${id}.log`;
		try {
			const text = await fetchText(url);
			results.push(analyze(text, id));
		} catch (e) {
			console.error(`${id}: ${e.message}`);
		}
	}
	if (results.length === 2 && results[0].winner && results[1].winner) {
		console.log('\n===== A/B summary =====');
		for (const [i, r] of results.entries()) {
			console.log(`battle ${i + 1}: winner=${r.winner} in ${r.turn} turns`);
		}
	}
})();
