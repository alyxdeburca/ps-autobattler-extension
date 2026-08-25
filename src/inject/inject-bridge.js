/**
 * inject-bridge.js -- runs in the MAIN world on play.pokemonshowdown.com.
 *
 * Exposes the live client battle state to the isolated-world content script
 * via window.postMessage (JSON strings -- objects do NOT survive cross-world
 * CustomEvent.detail reliably). Read-only observation except explicit UI
 * click commands used by opt-in autoplay.
 */
'use strict';

(function () {
	if (window.__PS_AUTOBATTLER_BRIDGE__) return;
	const BRIDGE = { version: 2 };
	window.__PS_AUTOBATTLER_BRIDGE__ = BRIDGE;

	const SRC_PAGE = 'psab-page';
	const SRC_CONTENT = 'psab-content';

	// ---- Dex backend (page's own Dex, for decision-core) -------------------
	BRIDGE.ensureDex = function () {
		// dex-shim reads window.__PS_DEX_BACKEND__ inside THIS world; nothing
		// needed here unless we later run decisions in-page too.
		return !!(window.Dex || window.BattleDex);
	};

	// ---- locate the active battle object -----------------------------------
	function findBattle() {
		try {
			const registries = [];
			if (window.app && window.app.rooms) registries.push(window.app.rooms);
			if (window.PS && PS.rooms) registries.push(PS.rooms);
			for (const rooms of registries) {
				// Prefer the focused room, then any battle room.
				const ids = Object.keys(rooms);
				ids.sort((a, b) => (
					(a.startsWith('battle-') ? 0 : 1) - (b.startsWith('battle-') ? 0 : 1)));
				for (const id of ids) {
					const room = rooms[id];
					const battle = room && room.battle;
					// A battle counts as soon as the object exists -- requests
					// come and go between turns; absence != absence of battle.
					if (battle && (battle.mySide || battle.sides || battle.request)) {
						return battle;
					}
				}
			}
		} catch (e) { /* client not ready */ }
		return null;
	}

	function hpText(mon) {
		try {
			const hp = Math.max(0, Math.ceil(mon.hp || 0));
			const max = Math.ceil(mon.maxhp || 100);
			return `${hp}/${max}${mon.hp ? '' : ' fnt'}`;
		} catch (e) {
			return '0/100 fnt';
		}
	}

	// ---- snapshot builder ----------------------------------------------------
	BRIDGE.getSnapshot = function () {
		const battle = findBattle();
		if (!battle) {
			return { connected: false, reason: 'no battle room found' };
		}

		let request = battle.request || null;
		if (typeof request === 'string') {
			try { request = JSON.parse(request); } catch (e) { request = null; }
		}
		// Some client versions stash the latest request elsewhere.
		if (!request && typeof battle.getRequest === 'function') {
			try { request = battle.getRequest() || null; } catch (e) { /* ignore */ }
		}

		let foeView = [];
		try {
			const foe = battle.foe || (battle.sides && battle.sides.find(
				s => s && s !== battle.mySide));
			if (foe && foe.active) {
				foeView = [{
					name: foe.name || '',
					species: String(foe.speciesForme || foe.species || '')
						.replace(/[^a-zA-Z0-9]/g, ''),
					level: foe.level || 100,
					types: (foe.getTypes && foe.getTypes()) || foe.types || [],
					hpRatio: foe.maxhp ? (foe.hp || 0) / foe.maxhp : 1,
					status: (foe.statusData && foe.statusData.id) || foe.status || '',
					moves: (foe.moveTrack || []).map(m => m[0]),
					item: foe.item || '',
					ability: foe.ability || '',
					terastallized: !!foe.terastallized,
				}];
			}
		} catch (e) { /* foe view best-effort */ }

		let myPokemon = [];
		try {
			myPokemon = ((battle.mySide && battle.mySide.pokemon) || []).map((mon, i) => ({
				slot: i + 1,
				ident: mon.ident || `p1${String.fromCharCode(97 + i)}: ${mon.speciesForme || ''}`,
				details: mon.details || mon.speciesForme || '',
				condition: hpText(mon),
				fainted: !mon.hp,
				active: !!mon.active,
				stats: mon.stats || {},
				moves: mon.moves || [],
				item: mon.item || '',
				ability: mon.ability || '',
				reviving: false,
			}));
		} catch (e) { /* own team best-effort */ }

		return {
			connected: true,
			hasRequest: !!request,
			reason: request ? '' : 'battle found, waiting for a decision point',
			battleId: battle.roomid || '',
			nickname: battle.nickname || '',
			myId: (battle.mySide && battle.mySide.id) || 'p1',
			turn: battle.turn || 0,
			request,
			foeView,
			myPokemon,
		};
	};

	// ---- postMessage command loop -------------------------------------------
	window.addEventListener('message', ev => {
		if (ev.source !== window) return;
		const msg = ev.data;
		if (!msg || msg.source !== SRC_CONTENT) return;

		if (msg.type === 'getSnapshot') {
			const snap = BRIDGE.getSnapshot();
			window.postMessage({
				source: SRC_PAGE,
				type: 'snapshot',
				reqId: msg.reqId,
				payload: JSON.stringify(snap),
			}, window.location.origin);
		} else if (msg.type === 'chooseMove' && typeof msg.slot === 'number') {
			clickControl('[data-move]', msg.slot);
		} else if (msg.type === 'chooseSwitch' && typeof msg.slot === 'number') {
			clickControl('[data-switch]', msg.slot);
		}
	});

	function clickControl(selector, slot) {
		try {
			const buttons = [...document.querySelectorAll(
				`.battle-controls button${selector}`)];
			const btn = buttons[slot - 1];
			if (btn && !btn.disabled) btn.click();
		} catch (e) { /* controls not present */ }
	}

	console.info('[PSAB] bridge v2 ready');
})();
