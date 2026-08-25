/**
 * decision-core.test.js
 *
 * Verifies the exact bundle path the extension uses at runtime:
 *   minidex backend -> dex-shim.setBackend -> decision-core.decideMove
 * in a browser-like environment (no Node require paths, no process access
 * inside decision-core).
 *
 * Run: npm install && npm run build && npm test
 */
'use strict';

const assert = require('assert');
const minidex = require('../src/data/minidex');
const { setBackend } = require('../vendor/ps-autobattler/src/dex-shim');
const core = require('../vendor/ps-autobattler/src/decision-core');
const trackerMod = require('../vendor/ps-autobattler/src/battle-state');
const est = require('../vendor/ps-autobattler/src/estimator');

setBackend(minidex);
// Production parity: same calc engine the content script wires in.
const smogon = require('../src/calc/smogon-calc').expectedDamagePct;
est.setCalcEngine(smogon);

// ---------------------------------------------------------------------------
// MiniDex sanity (mirrors ps-autobattler's estimator tests)
// ---------------------------------------------------------------------------
let passed = 0;
function ok(name, fn) {
	try { fn(); passed++; console.log(`ok - ${name}`); }
	catch (e) {
		console.error(`FAIL - ${name}\n   ${e.message}`);
		process.exitCode = 1;
	}
}

ok('minidex: species lookup + types', () => {
	const gengar = minidex.species.get('gengar');
	assert.strictEqual(gengar.name, 'Gengar');
	assert.deepStrictEqual(gengar.types, ['Ghost', 'Poison']);
});

ok('minidex: immunity Normal vs Ghost', () => {
	assert.strictEqual(minidex.getImmunity('Normal', ['Ghost', 'Poison']), false);
});

ok('smogon-calc: engine returns sane damage', () => {
	const dexShim = require('../vendor/ps-autobattler/src/dex-shim');
	const mv = dexShim.moveFromId('earthquake');
	const pct = smogon({
		attacker: { species: 'garchomp', level: 81, types: ['Dragon', 'Ground'], status: '' },
		defender: { types: ['Ghost', 'Poison'], level: 78, hpRatio: 1 },
		move: mv,
		attackerStats: { hp: 253, atk: 182, def: 131, spa: 105, spd: 111, spe: 169 },
		defenderSpecies: dexShim.speciesFromId('gengar'),
	});
	assert.ok(Number.isFinite(pct) && pct > 100,
		`expected OHKO-range %, got ${pct}`);
});

// ---------------------------------------------------------------------------
// Full decision pipeline with a realistic request payload
// ---------------------------------------------------------------------------
const REQUEST = {
	active: [{
		moves: [
			{ move: 'Body Slam', id: 'bodyslam', pp: 24, maxpp: 24, disabled: false },
			{ move: 'Earthquake', id: 'earthquake', pp: 96, maxpp: 96, disabled: false },
		],
		trapped: false,
	}],
	side: {
		id: 'p1',
		pokemon: [
			{
				ident: 'p1a: Garchomp',
				details: 'Garchomp, L81, M',
				condition: '253/253',
				active: true,
				stats: { atk: 182, def: 131, spa: 105, spd: 111, spe: 169 },
				moves: ['bodyslam', 'earthquake'],
				baseAbility: 'roughskin',
				item: '',
			},
			{
				ident: 'p1b: Corviknight',
				details: 'Corviknight, L76, F',
				condition: '219/219',
				active: false,
				stats: { atk: 120, def: 145, spa: 78, spd: 92, spe: 87 },
				moves: ['bravebird'],
				baseAbility: 'pressure',
				item: '',
			},
		],
	},
};

ok('decision-core: chooses a move vs. known foe', () => {
	const tracker = new trackerMod.BattleTracker('p1');
	// Foe is Ghost/Poison: bodyslam immune, earthquake neutral STAB.
	tracker.seeLine('|switch|p2a: Gengar|Gengar, L78, M|200/200');
	const { choice, best } = core.decideMove(tracker, REQUEST);
	assert.ok(choice.startsWith('move'), `expected a move, got ${choice}`);
	assert.strictEqual(best.id, 'earthquake',
		'EQ should beat immune Body Slam');
});

ok('decision-core: switch candidate present & scored', () => {
	const tracker = new trackerMod.BattleTracker('p1');
	tracker.seeLine('|switch|p2a: Gengar|Gengar, L78, M|200/200');
	const { candidates } = core.decideMove(tracker, REQUEST);
	const sw = candidates.find(c => c.kind === 'switch');
	assert.ok(sw, 'should offer a switch option');
	assert.strictEqual(sw.slot, 2);
	assert.ok(typeof sw.score === 'number' && Number.isFinite(sw.score));
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}`);
