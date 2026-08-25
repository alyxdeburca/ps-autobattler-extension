/**
 * overlay.js -- in-page suggestion tab, Showdex-style.
 *
 * A collapsible dark panel docked top-right of the battle page. Rendered
 * entirely by the content script from the shared `status` object; includes
 * its own autoplay toggle (same JS world -- no messaging needed).
 */
'use strict';

const STYLES = `
#psab-tab {
  position: fixed; top: 10px; right: 10px; z-index: 99998;
  width: 235px; font: 12px/1.45 system-ui, sans-serif;
  color: #e8eaed; background: rgba(28,30,34,.96);
  border: 1px solid #55595f; border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0,0,0,.4);
  user-select: none;
}
#psab-tab .psab-head {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 10px; cursor: pointer;
  font-weight: 700; letter-spacing: .2px;
}
#psab-tab .psab-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #777; flex: none;
}
#psab-tab .psab-dot.ready  { background: #57d16a; }
#psab-tab .psab-dot.waiting{ background: #e5b567; }
#psab-tab .psab-dot.nobattle,{ background: #777; }
#psab-tab .psab-dot.error  { background: #e5534b; }
#psab-tab .psab-chevron { margin-left: auto; color: #9aa0a6; font-size: 10px; }
#psab-tab .psab-body {
  padding: 4px 10px 9px; border-top: 1px solid #3c4048;
}
#psab-tab .psab-note { color: #9aa0a6; padding: 4px 0; }
#psab-tab ol { margin: 4px 0 0; padding-left: 16px; }
#psab-tab li { margin: 3px 0; }
#psab-tab li.best { color: #8ab4f8; font-weight: 700; }
#psab-tab .bar {
  height: 3px; background: #33363c; border-radius: 2px;
  margin-top: 2px; overflow: hidden;
}
#psab-tab .bar i {
  display: block; height: 100%; background: #8ab4f8; border-radius: 2px;
}
#psab-tab li.best .bar i { background: #aecbfa; }
#psab-tab .auto-row {
  display: flex; align-items: center; gap: 6px;
  margin-top: 7px; padding-top: 6px;
  border-top: 1px solid #3c4048; color: #dadce0;
}
`;

function pctBar(dmg) {
	const w = Math.max(2, Math.min(100, dmg || 0));
	return `<span class="bar"><i style="width:${w}%"></i></span>`;
}

/**
 * Mounts the tab. Returns an update(status) function.
 * @param {(v:boolean)=>void} setAuto
 */
function mount(setAuto) {
	if (document.getElementById('psab-tab')) return () => {};

	const style = document.createElement('style');
	style.textContent = STYLES;
	document.documentElement.appendChild(style);

	const root = document.createElement('div');
	root.id = 'psab-tab';
	root.innerHTML = `
	  <div class="psab-head">
	    <span class="psab-dot"></span>
	    <span>PS Auto-Battler</span>
	    <span class="psab-chevron">▼</span>
	  </div>
	  <div class="psab-body">
	    <div class="psab-note">starting…</div>
	    <ol></ol>
	    <label class="auto-row">
	      <input type="checkbox" class="psab-auto"> autoplay
	    </label>
	  </div>`;
	document.documentElement.appendChild(root);

	const head = root.querySelector('.psab-head');
	const body = root.querySelector('.psab-body');
	const dotEl = root.querySelector('.psab-dot');
	const chev = root.querySelector('.psab-chevron');
	const noteEl = root.querySelector('.psab-note');
	const listEl = root.querySelector('ol');
	const autoEl = root.querySelector('.psab-auto');

	// restore collapse state
	let collapsed = false;
	try { collapsed = localStorage.getItem('psab-collapsed') === '1'; } catch (e) {}
	function applyCollapse() {
		body.style.display = collapsed ? 'none' : '';
		chev.textContent = collapsed ? '▸' : '▼';
	}
	applyCollapse();
	head.addEventListener('click', () => {
		collapsed = !collapsed;
		try { localStorage.setItem('psab-collapsed', collapsed ? '1' : '0'); } catch (e) {}
		applyCollapse();
	});

	autoEl.addEventListener('change', () => setAuto(autoEl.checked));

	return function update(status) {
		if (!status) return;
		dotEl.className = `psab-dot ${status.state || ''}`;
		autoEl.checked = !!status.auto;

		if (status.state !== 'ready') {
			noteEl.style.display = '';
			listEl.innerHTML = '';
			noteEl.textContent = status.reason ||
				({ waiting: 'battle found · waiting…' }[status.state] || 'starting…');
			return;
		}
		noteEl.style.display = 'none';
		listEl.innerHTML = '';
		for (const c of (status.candidates || []).slice().sort((a, b) =>
			(b.score || 0) - (a.score || 0))) {
			const li = document.createElement('li');
			const isBest = status.best && c.kind === status.best.kind &&
				c.slot === status.best.slot;
			if (isBest) li.classList.add('best');
			const label = c.kind === 'switch'
				? `⇄ ${c.name || c.id}${c.flippedBack ? ' ↩' : ''}`
				: `${c.name || c.id}`;
			li.append(document.createTextNode(label));
			if (c.dmg != null && c.dmg > 0) {
				li.appendChild(document.createElement('div'));
				li.lastChild.outerHTML = pctBar(c.dmg);
			}
			listEl.appendChild(li);
		}
	};
}

module.exports = { mount };
