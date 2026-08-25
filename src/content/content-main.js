/**
 * content-main.js -- isolated world content script (headless brain).
 *
 * No visible UI. Runs the decision loop against snapshots from the
 * MAIN-world bridge and exposes results over chrome.runtime messaging so
 * the browser-action popup can display them when opened.
 */
'use strict';

const core = require('../../vendor/ps-autobattler/src/decision-core');
const trackerMod = require('../../vendor/ps-autobattler/src/battle-state');
const { BattleTracker } = trackerMod;

// ---------------------------------------------------------------------------
// Bridge communication (DOM CustomEvents to MAIN world)
// ---------------------------------------------------------------------------
let pendingResolvers = [];
function requestSnapshot() {
	return new Promise(resolve => {
		pendingResolvers.push(resolve);
		document.dispatchEvent(new CustomEvent('psab-command', {
			detail: { type: 'getSnapshot' },
		}));
		setTimeout(() => {
			const idx = pendingResolvers.indexOf(resolve);
			if (idx >= 0) { pendingResolvers.splice(idx, 1); resolve(null); }
		}, 500);
	});
}
document.addEventListener('psab-snapshot', ev => {
	const resolve = pendingResolvers.shift();
	if (resolve) resolve(ev.detail || null);
});

function sendCommand(detail) {
	document.dispatchEvent(new CustomEvent('psab-command', { detail }));
}

// ---------------------------------------------------------------------------
// Decision loop (silent)
// ---------------------------------------------------------------------------
const tracker = new BattleTracker('p1');
let lastRequestHash = '';
let auto = false;
let loopBusy = false;

// Status consumed by the popup.
const status = {
	ok: false,            // a decision is available
	reason: 'starting…',  // human-readable state when !ok
	battleUrl: location.href,
	turn: 0,
	choice: '',
	candidates: [],
	best: null,
	auto: false,
	updatedAt: 0,
};

function hashRequest(req) {
	return JSON.stringify(req && req.side ? req.side.pokemon.map(p => p.ident + p.condition) : '') +
		'|' + JSON.stringify(req ? (req.active || req.forceSwitch || '').toString().slice(0, 200) : '');
}

async function decideOnce(snap) {
	tracker.seeRequest(snap.request);
	for (const fv of snap.foeView) {
		if (!fv.species) continue;
		const ident = `p2a: ${fv.name || fv.species}`;
		tracker.seeLine(`|switch|${ident}|${fv.species}, L${fv.level}|100/100`);
		if (fv.moves) for (const m of fv.moves) tracker.seeLine(`|move|${ident}|${m}`);
		if (fv.status) tracker.seeLine(`|-status|${ident}|${fv.status}`);
		if (fv.ability) tracker.seeLine(`|-ability|${ident}|${fv.ability}`);
		if (fv.item) tracker.seeLine(`|-item|${ident}|${fv.item}`);
	}
	tracker.turn = snap.turn;

	const req = snap.request;
	if (req.wait) return { choice: '', candidates: [] };
	if (req.teamPreview) return { choice: 'default', candidates: [] };
	if (req.forceSwitch) {
		const choice = core.decideForceSwitch(tracker, req);
		return { choice, candidates: [{ kind: 'switch', name: choice }] };
	}
	if (req.active) return core.decideMove(tracker, req);
	return { choice: 'default', candidates: [] };
}

async function act(choice) {
	const [kind, slotStr] = choice.split(' ');
	const slot = parseInt(slotStr, 10);
	if (kind === 'move' && Number.isFinite(slot)) sendCommand({ type: 'chooseMove', slot });
	else if (kind === 'switch' && Number.isFinite(slot)) sendCommand({ type: 'chooseSwitch', slot });
}

setInterval(async () => {
	if (loopBusy) return;
	loopBusy = true;
	try {
		const snap = await requestSnapshot();
		if (!snap) {
			status.ok = false;
			status.reason = 'no active battle on this tab';
			return;
		}
		status.turn = snap.turn;
		const h = hashRequest(snap.request);
		if (h !== lastRequestHash) {
			lastRequestHash = h;
			const { choice, candidates, best } = await decideOnce(snap);
			Object.assign(status, {
				ok: true, choice, candidates, best,
				auto, updatedAt: Date.now(),
			});
			if (auto && choice && choice !== 'default') await act(choice);
			else if (auto && choice === 'default') sendCommand({ type: 'chooseMove', slot: 1 });
		}
	} catch (e) {
		status.ok = false;
		status.reason = `error: ${e.message}`;
	} finally {
		loopBusy = false;
	}
}, 700);

// ---------------------------------------------------------------------------
// Popup messaging API
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (!msg || !msg.type) return;
	if (msg.type === 'psab-get-status') {
		status.auto = auto;
		sendResponse(status);
	} else if (msg.type === 'psab-set-autoplay') {
		auto = !!msg.value;
		status.auto = auto;
		sendResponse(status);
	}
	// synchronous responses only; no `return true` needed
});

console.info('[PSAB] headless brain ready');
