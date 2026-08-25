/**
 * inject-bridge.js -- runs in the MAIN world on play.pokemonshowdown.com.
 *
 * The Showdown client already parses every battle: `app.curRoom`'s battle
 * object holds the live request JSON, both sides' tracked pokemon (including
 * revealed foe moves) and the typed Dex. This bridge exposes a minimal,
 * read-only facade plus a Dex backend for the ps-autobattler decision core.
 * It posts state to the window and relays commands (e.g. AUTOPLAY clicks)
 * from the isolated-world content script via CustomEvents.
 */
'use strict';

(function () {
	if (window.__PS_AUTOBATTLER_BRIDGE__) return;
	const BRIDGE = { version: 1 };
	window.__PS_AUTOBATTLER_BRIDGE__ = BRIDGE;

	// ---- Dex backend for decision-core (page's own Dex, no engine bundled) --
	function pageDex() {
		if (window.Dex && window.Dex.forFormat) return window.Dex;
		if (window.BattleDex && window.BattleDex.forFormat) return window.BattleDex;
		return null;
	}
	BRIDGE.ensureDex = function () {
		const dex = pageDex();
		if (!dex) return false;
		if (!window.__PS_DEX_BACKEND__) {
			window.__PS_DEX_BACKEND__ = dex; // dex-shim resolves this in browser
		}
		return true;
	};

	// ---- locate the active battle object --------------------------------
	function findBattle() {
		try {
			// Modern client: app.rooms[roomid].battle
			const app = window.app;
			if (!app || !app.rooms) return null;
			for (const id of Object.keys(app.rooms)) {
				const room = app.rooms[id];
				if (room && room.battle && room.battle.request) return room.battle;
			}
			// Fallback: room id is "battle-" prefixed on current tab
			const cur = app.curRoom && app.rooms[app.curRoom];
			if (cur && cur.battle && cur.battle.request) return cur.battle;
		} catch (e) { /* client not ready */ }
		return null;
	}

	// ---- snapshot builder ------------------------------------------------
	BRIDGE.getSnapshot = function () {
		const battle = findBattle();
		if (!battle) return null;
		let request = battle.request;
		if (typeof request === 'string') {
			try { request = JSON.parse(request); } catch (e) { request = null; }
		}
		if (!request) return null;

		const myId = battle.mySide && battle.mySide.id;
		const foe = battle.foe || null;

		const foeView = foe && foe.active ? [{
			name: foe.name,
			species: (foe.speciesForme || foe.species || '').replace(/-/g, ''),
			level: foe.level,
			types: (foe.getTypes && foe.getTypes()) || foe.types || [],
			hpRatio: foe.hp ? (foe.maxhp ? foe.hp / foe.maxhp : 0) : 1,
			status: (foe.statusData && foe.statusData.id) || foe.status || '',
			moves: (foe.moveTrack || []).map(m => m[0]),
			item: (foe.item !== '' && foe.item) || '',
			ability: foe.ability || '',
			terastallized: !!foe.terastallized,
		}] : [];

		const myPokemon = ((battle.mySide && battle.mySide.pokemon) || [])
			.map((mon, i) => ({
				slot: i + 1,
				ident: mon.ident || '',
				details: mon.details || '',
				condition: `${Math.ceil(mon.hp)}${mon.maxhp ? '/' + Math.ceil(mon.maxhp) : '/100'}${mon.status ? ' ' + mon.status : ''}${(mon.hp === 0) ? ' fnt'.slice(0, 0) : ''}`,
				fainted: !mon.hp,
				active: !!mon.active,
				stats: mon.stats || {},
				moves: mon.moves || [],
				item: mon.item || '',
				ability: mon.ability || '',
				reviving: false,
			}));

		return {
			battleJoined: true,
			myId,
			request,
			foeView,
			myPokemon,
			turn: battle.turn || 0,
			nickname: battle.nickname || '',
		};
	};

	// ---- command relay (isolated world -> here) --------------------------
	window.addEventListener('psab-command', ev => {
		const detail = ev.detail || {};
		if (detail.type === 'getSnapshot') {
			document.dispatchEvent(new CustomEvent('psab-snapshot', {
				detail: BRIDGE.getSnapshot(),
			}));
		} else if (detail.type === 'chooseMove' && typeof detail.slot === 'number') {
			tryClickMove(detail.slot);
		} else if (detail.type === 'chooseSwitch' && typeof detail.slot === 'number') {
			tryClickSwitch(detail.slot);
		}
	});

	// ---- UI automation (used only by AUTOPLAY) ---------------------------
	function controlBar() {
		const roomEl = document.querySelector('.battle .battle-controls');
		return roomEl;
	}
	function tryClickMove(slot) {
		const bar = controlBar();
		if (!bar) return;
		// Move buttons carry movename in [data-value]; index = slot-1 among enabled buttons.
		const buttons = [...bar.querySelectorAll('button[data-move]')];
		const btn = buttons[slot - 1];
		if (btn && !btn.disabled) btn.click();
	}
	function tryClickSwitch(slot) {
		const bar = controlBar();
		if (!bar) return;
		const buttons = [...bar.querySelectorAll('button[data-switch]')];
		const btn = buttons[slot - 1];
		if (btn && !btn.disabled) btn.click();
	}

	console.info('[PSAB] bridge ready');
})();
