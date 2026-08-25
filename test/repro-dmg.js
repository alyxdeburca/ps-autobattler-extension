/**
 * Repro: extension production path -- bridge-shaped foe view into
 * decision-core with the @smogon/calc engine wired, print per-move dmg.
 */
'use strict';
const minidex = require('../src/data/minidex');
const { setBackend } = require('../vendor/ps-autobattler/src/dex-shim');
const core = require('../vendor/ps-autobattler/src/decision-core');
const trackerMod = require('../vendor/ps-autobattler/src/battle-state');
const est = require('../vendor/ps-autobattler/src/estimator');
const smogon = require('../src/calc/smogon-calc').expectedDamagePct;

setBackend(minidex);
est.setCalcEngine(smogon);

// Bridge-shaped foe view (what inject-bridge produces)
const snapFoeView = [{
	name: 'Blissey',
	species: 'Blissey',
	level: 80,
	types: ['Normal'],
	hpRatio: 1,
	status: '',
	moves: ['softboiled'],
	item: '',
	ability: '',
	terastallized: false,
}];

const REQUEST = {
	active: [{
		moves: [
			{ move: 'Body Slam', id: 'bodyslam', pp: 24, maxpp: 24, disabled: false },
			{ move: 'Earthquake', id: 'earthquake', pp: 96, maxpp: 96, disabled: false },
			{ move: 'Swords Dance', id: 'swordsdance', pp: 16, maxpp: 16, disabled: false },
		],
		trapped: false,
	}],
	side: {
		id: 'p1',
		pokemon: [
			{
				ident: 'p1a: Garchomp', details: 'Garchomp, L81, M', condition: '253/253',
				active: true,
				stats: { hp: 253, atk: 182, def: 131, spa: 105, spd: 111, spe: 169 },
				moves: ['bodyslam', 'earthquake', 'swordsdance'], item: 'leftovers',
			},
			{
				ident: 'p1b: Corviknight', details: 'Corviknight, L76, F', condition: '219/219',
				active: false,
				stats: { hp: 219, atk: 120, def: 145, spa: 78, spd: 92, spe: 87 },
				moves: ['bravebird'], item: '',
			},
		],
	},
};

const tracker = new trackerMod.BattleTracker('p1');
tracker.seeRequest(REQUEST);
for (const fv of snapFoeView) {
	const ident = `p2a: ${fv.name || fv.species}`;
	tracker.seeLine(`|switch|${ident}|${fv.species}, L${fv.level}|600/600`);
	for (const m of fv.moves) tracker.seeLine(`|move|${ident}|${m}`);
}
tracker.turn = 3;

const out = core.decideMove(tracker, REQUEST);
for (const c of out.candidates) {
	console.log(`${c.kind.padEnd(6)} ${(c.name || c.id).padEnd(14)} score=${(c.score ?? 0).toFixed(1)} dmg=${c.dmg !== undefined ? c.dmg.toFixed(1) : '-'}`);
}
console.log('best:', out.best && out.best.name, '| choice:', out.choice);

// Direct engine probes
const dexShim = require('../vendor/ps-autobattler/src/dex-shim');
for (const mid of ['bodyslam', 'earthquake']) {
	try {
		const pct = smogon({
			attacker: { species: 'Garchomp', level: 81, types: ['Dragon', 'Ground'], status: '', item: 'leftovers' },
			defender: { types: ['Normal'], level: 80, hpRatio: 1 },
			move: dexShim.moveFromId(mid),
			attackerStats: REQUEST.side.pokemon[0].stats,
			defenderSpecies: dexShim.speciesFromId('blissey'),
		});
		console.log(`engine ${mid}: ${Number.isFinite(pct) ? pct.toFixed(1) + '%' : 'NaN'}`);
	} catch (e) {
		console.log(`engine ${mid}: THREW ${e.message}`);
	}
}
