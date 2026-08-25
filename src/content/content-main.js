/**
 * content-main.js -- isolated world content script.
 *
 * Polls the MAIN-world bridge for battle snapshots, runs them through the
 * ps-autobattler decision core (submodule, bundled at build time), renders
 * a suggestion overlay, and optionally AUTOPLAYs by relaying click commands.
 */
'use strict';

const core = require('../../vendor/ps-autobattler/src/decision-core');
const trackerMod = require('../../vendor/ps-autobattler/src/battle-state');
const { BattleTracker } = trackerMod;

// ---------------------------------------------------------------------------
// Bridge communication
// ---------------------------------------------------------------------------
let pendingResolvers = [];
function requestSnapshot() {
	return new Promise(resolve => {
		pendingResolvers.push(resolve);
		document.dispatchEvent(new CustomEvent('psab-command', {
			detail: { type: 'getSnapshot' },
		}));
		// Timeout: bridge missing (page not a battle?) -> null
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

// ---------------------------------------------------------------------------
// Decision loop
// ---------------------------------------------------------------------------
const tracker = new BattleTracker('p1'); // we re-side per snapshot via request
let lastRequestHash = '';
let auto = false;
let loopBusy = false;

function hashRequest(req) {
	return JSON.stringify(req && req.side ? req.side.pokemon.map(p => p.ident + p.condition) : '') +
		'|' + JSON.stringify(req ? (req.active || req.forceSwitch || '').toString().slice(0, 200) : '');
}

async function decideOnce(snap) {
	// Sync tracker with client-known state
	tracker.seeRequest(snap.request);
	for (const line of []) tracker.seeLine(line); // no raw lines; client pre-parses
	for (const fv of snap.foeView) {
		// Mirror foe knowledge into tracker via synthetic protocol lines so the
		// same code paths as headless mode are exercised.
		if (!fv.species) continue;
		const ident = `p2a: ${fv.name || fv.species}`;
		tracker.seeLine(`|switch|${ident}|${fv.species}, L${fv.level}|100/100`);
		if (fv.moves) for (const m of fv.moves) {
			tracker.seeLine(`|move|${ident}|${m}`);
		}
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
	if (req.active) {
		const out = core.decideMove(tracker, req);
		return out;
	}
	return { choice: 'default', candidates: [] };
}

// ---------------------------------------------------------------------------
// Overlay UI
// ---------------------------------------------------------------------------
const panel = document.createElement('div');
panel.id = 'psab-panel';
panel.innerHTML = `
  <div class="psab-head">
    <span class="psab-title">PS Auto-Battler</span>
    <label class="psab-auto"><input type="checkbox" id="psab-autoplay"> autoplay</label>
  </div>
  <ol class="psab-list" id="psab-list"></ol>
  <div class="psab-foot" id="psab-foot">waiting for battle…</div>
`;
document.body && document.body.appendChild(panel);

function render(candidates, best, note) {
	const list = panel.querySelector('#psab-list');
	list.innerHTML = '';
	for (const c of candidates) {
		const li = document.createElement('li');
		li.className = 'psab-item' + (c === best ? ' psab-best' : '');
		const label = c.kind === 'switch'
			? `⇄ ${c.name || c.id} (slot ${c.slot})`
			: `${c.name || c.id}${c.dmg != null ? ` · ~${Math.round(c.dmg)}%` : ''}`;
		li.innerHTML = `<span>${label}</span><b>${(c.score ?? 0).toFixed(1)}</b>`;
		list.appendChild(li);
	}
	panel.querySelector('#psab-foot').textContent =
		note || (best ? `best: ${best.name || best.id}` : 'no suggestion');
}

panel.querySelector('#psab-autoplay').addEventListener('change', ev => {
	auto = ev.target.checked;
});

function sendCommand(detail) {
	document.dispatchEvent(new CustomEvent('psab-command', { detail }));
}

async function act(choice) {
	const [kind, slotStr] = choice.split(' ');
	const slot = parseInt(slotStr, 10);
	if (kind === 'move' && Number.isFinite(slot)) sendCommand({ type: 'chooseMove', slot });
	else if (kind === 'switch' && Number.isFinite(slot)) sendCommand({ type: 'chooseSwitch', slot });
}

// ---------------------------------------------------------------------------
// Main polling loop
// ---------------------------------------------------------------------------
setInterval(async () => {
	if (loopBusy) return;
	loopBusy = true;
	try {
		const snap = await requestSnapshot();
		if (!snap) {
			panel.querySelector('#psab-foot').textContent = 'no active battle detected';
			panel.style.display = 'none';
			return;
		}
		panel.style.display = '';
		const h = hashRequest(snap.request);
		if (h !== lastRequestHash) {
			lastRequestHash = h;
			const { choice, candidates, best } = await decideOnce(snap);
			render(candidates, best, `turn ${snap.turn} · best: ${
				best ? (best.name || best.id) : choice}`);
			if (auto && choice && choice !== 'default') await act(choice);
			else if (auto && choice === 'default') sendCommand({ type: 'chooseMove', slot: 1 });
		}
	} catch (e) {
		panel.querySelector('#psab-foot').textContent = `error: ${e.message}`;
	} finally {
		loopBusy = false;
	}
}, 700);

console.info('[PSAB] content script ready');
