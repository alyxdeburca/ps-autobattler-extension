/**
 * smogon-calc.js
 *
 * High-fidelity damage engine for the extension: adapts @smogon/calc (the
 * same math Showdex prints) into ps-autobattler's setCalcEngine() contract.
 *
 * Contract: ({attacker, defender, move, attackerStats, defenderSpecies})
 *   -> number  (expected damage as % of the defender's max HP)
 * Throws on anything unrecognized -- the estimator falls back to its
 * internal heuristic, so this can never break decisions.
 */
'use strict';

const { Generations, Pokemon, Move, calculate } = require('@smogon/calc');

let genCache = null;
function gen() {
	if (!genCache) genCache = Generations.get(9);
	return genCache;
}

/** Mean of the 16 damage rolls, as % of defender max HP. */
function rollsToPct(damage, maxHP) {
	const rolls = Array.isArray(damage)
		? damage.flat(Infinity).map(Number).filter(Number.isFinite)
		: [Number(damage)];
	if (!rolls.length || !maxHP) return NaN;
	const mean = rolls.reduce((a, b) => a + b, 0) / rolls.length;
	return (mean / maxHP) * 100;
}

function makePokemon(speciesId, level, opts = {}) {
	const p = new Pokemon(gen(), String(speciesId || ''), {
		level: level || 100,
		nature: 'serious',
		...(opts.item ? { item: opts.item } : {}),
		...(opts.ability ? { ability: opts.ability } : {}),
		...(opts.status ? { status: opts.status } : {}),
		// @smogon/calc spells it: teraType + terastallized:true
		...(opts.teraType
			? { teraType: opts.teraType, terastallized: true }
			: {}),
	});
	// Live stat stages (Calm Mind etc.) -- applied via boostBy.
	if (opts.boosts && typeof p.boostBy === 'function') {
		p.boostBy(opts.boosts);
	}
	return p;
}

/**
 * Expected damage % via @smogon/calc.
 * See ps-autobattler/src/estimator.js for the option shape.
 */
function expectedDamagePct({ attacker, defender, move, attackerStats, defenderSpecies }) {
	if (!move || !defenderSpecies) return NaN;

	// Status moves carry no damage; report 0 quickly.
	if (move.category === 'Status') return 0;

	const atk = makePokemon(attacker && attacker.species,
		attacker && attacker.level, {
			status: attacker && attacker.status,
			item: attacker && attacker.item,
			ability: attacker && attacker.ability,
			teraType: attacker && attacker.willTera ? attacker.teraType : '',
			boosts: attacker && attacker.boosts,
		});

	// Exact own-team stats straight from the client request.
	if (attackerStats && atk.rawStats) {
		for (const s of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
			if (Number.isFinite(attackerStats[s]) && attackerStats[s] > 0) {
				atk.rawStats[s] = attackerStats[s];
				atk.stats[s] = attackerStats[s];
			}
		}
	}

	// Always construct the defender from species so @smogon/calc applies its
	// own full typing/mechanics data.
	const def = makePokemon(
		defenderSpecies.id || defenderSpecies.name,
		defender.level || 100, {});

	const mv = new Move(gen(), move.name || move.id);

	const result = calculate(gen().num, atk, def, mv);
	return rollsToPct(result.damage, def.rawStats ? def.rawStats.hp : 0);
}

module.exports = { expectedDamagePct };
