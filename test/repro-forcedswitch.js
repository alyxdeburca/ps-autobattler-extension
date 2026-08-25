/**
 * Repro: forced-switch selection after a faint -- does it pick best matchup
 * or party order? Uses the extension's production wiring.
 *
 * NOTE: the foe here is a STAND-IN. The real trigger from the user's battles
 * is a foe whose species the tracker never learned (e.g. Illusion/Zoroark
 * revealed via |replace|, or a switch-in we only saw through damage lines).
 * With species unknown, matchupScore returns 0 for every bench mon and
 * hpRatio decides -- i.e. "next healthiest", which reads as party order.
 */
'use strict';
const minidex = require('../src/data/minidex');
const { setBackend } = require('../vendor/ps-autobattler/src/dex-shim');
const core = require('../vendor/ps-autobattler/src/decision-core');
const trackerMod = require('../vendor/ps-autobattler/src/battle-state');
const est = require('../vendor/ps-autobattler/src/estimator');

setBackend(minidex);
est.setCalcEngine(require('../src/calc/smogon-calc').expectedDamagePct);

// Foe: Hisuian Typhlosion (Fire/Ghost) with fire STAB revealed.
function makeTracker(foeSpecies) {
	const tracker = new trackerMod.BattleTracker('p1');
	tracker.seeLine(`|switch|p2a: ${foeSpecies}|${foeSpecies}, L82, M|280/280`);
	tracker.seeLine('|move|p2a: Typhlosion|Eruption');
	tracker.turn = 6;
	return tracker;
}

const REQUEST = {
	active: [{ moves: [], trapped: false }],
	forceSwitch: [true],
	side: {
		id: 'p1',
		pokemon: [
			{ ident: 'p1a: Machamp', details: 'Machamp, L80, M', condition: '0 fnt',
				active: true, stats: { atk: 150 }, moves: [], item: '' },
			{ ident: 'p1b: Chandelure', details: 'Chandelure, L80, M', condition: '220/220',
				active: false, stats: { atk: 60, def: 100, spa: 160, spd: 120, spe: 80 },
				moves: ['shadowball'], item: '' },
			{ ident: 'p1c: Blissey', details: 'Blissey, L80, F', condition: '600/600',
				active: false, stats: { atk: 20, def: 60, spa: 80, spd: 200, spe: 50 },
				moves: ['seismictoss'], item: '' },
			{ ident: 'p1d: Dondozo', details: 'Dondozo, L80, M', condition: '180/180',
				active: false, stats: { atk: 140, def: 130, spa: 65, spd: 65, spe: 30 },
				moves: ['wavecrash'], item: '' },
		],
	},
};

for (const foe of ['Typhlosion-Hisui', 'UnknownPokemon']) {
	const tracker = makeTracker(foe);
	tracker.seeRequest(REQUEST);
	console.log(`\nfoe known as "${foe}":`,
		core.decideForceSwitch(tracker, REQUEST));
}
console.log('\n(expected: Chandelure/Dondozo resist Fire; with UNKNOWN foe,');
console.log(' matchupScore=0 everywhere and raw HP decides -> party-order feel)');
