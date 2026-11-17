import { CODEX, NOTES } from '../lore.js';

// DOM overlays styled like a VCR's on-screen display. There is no HUD:
// only faint, temporary text.

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class UI {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.modal = null;
    this.message = el('div', 'message');
    this.card = el('div', 'card osd');
    this.hintEl = el('div', 'hint osd');
    this.promptEl = el('div', 'prompt osd');
    this.toastEl = el('div', 'toast osd');
    this.dot = el('div', 'dot');
    for (const e of [this.message, this.card, this.hintEl, this.promptEl, this.toastEl, this.dot]) root.appendChild(e);
    this.menuEl = null;
    this.pauseEl = null;
    this.sel = 0;
    this.items = [];
  }

  // ---------- transient text ----------
  showMessage(text, dur = 6) {
    this.message.textContent = text;
    this.message.classList.add('show');
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => this.message.classList.remove('show'), dur * 1000);
  }
  levelCard(name, title) {
    this.card.innerHTML = `<div class="n">${name}</div><div class="t">${title}</div>`;
    this.card.classList.add('show');
    clearTimeout(this._cardT);
    this._cardT = setTimeout(() => this.card.classList.remove('show'), 9000);
  }
  hint(text, dur = 6) {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.hintEl.classList.remove('show'), dur * 1000);
  }
  setPrompt(text) {
    if (text === this._prompt) return;
    this._prompt = text;
    if (text) {
      this.promptEl.textContent = '[E] ' + text;
      this.promptEl.classList.add('show');
      this.dot.classList.add('show');
    } else {
      this.promptEl.classList.remove('show');
      this.dot.classList.remove('show');
    }
  }
  toast(text, dur = 3) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), dur * 1000);
  }
  codexToast(kind) {
    if (kind === 'level') return; // levels announce themselves with the card
    setTimeout(() => this.toast('Journal updated', 3), 1200);
  }

  // ---------- boot / menu ----------
  showBoot() {
    const b = el('div', 'boot osd interactive', `<div class="big blink">▶ INSERT TAPE</div><div class="small">click to play · headphones recommended</div>`);
    b.addEventListener('click', () => {
      b.remove();
      this.game.boot();
    });
    this.root.appendChild(b);
  }

  _list(container, defs) {
    this.items = [];
    container.innerHTML = '';
    defs.forEach((d, i) => {
      const it = el('div', 'item' + (d.disabled ? ' disabled' : ''), d.label);
      it.addEventListener('mouseenter', () => {
        if (!d.disabled) this._select(i);
      });
      it.addEventListener('click', () => {
        if (!d.disabled) {
          this.game.audio.play('click', { gain: 0.4, bus: 'ui' });
          d.fn();
        }
      });
      container.appendChild(it);
      this.items.push({ el: it, ...d });
    });
    this.sel = defs.findIndex((d) => !d.disabled);
    this._select(this.sel);
  }
  _select(i) {
    this.sel = i;
    this.items.forEach((it, j) => it.el.classList.toggle('sel', j === i));
  }

  showMenu(hasSave) {
    this.hideMenu();
    const m = el('div', 'menu osd interactive');
    m.innerHTML = `<div class="play">PLAY ▶</div><div class="sp">SP</div>
      <div class="title">NOCLIPPED</div><div class="subtitle">a recovered tape</div>
      <div class="items"></div>
      <div class="counter"><div class="cnt">0:00:00</div><div>OCT. 29 1996</div></div>`;
    this.root.appendChild(m);
    this.menuEl = m;
    const items = m.querySelector('.items');
    this._list(items, [
      { label: 'Continue tape', fn: () => this.game.continueGame(), disabled: !hasSave },
      { label: 'New tape', fn: () => this.game.newGame() },
      { label: 'Journal', fn: () => this.showJournal() },
      { label: 'Settings', fn: () => this.showSettings() },
    ]);
    const t0 = performance.now();
    const cnt = m.querySelector('.cnt');
    this._cntI = setInterval(() => {
      const s = Math.floor((performance.now() - t0) / 1000) + 5410;
      cnt.textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
  }
  hideMenu() {
    if (this.menuEl) this.menuEl.remove();
    this.menuEl = null;
    clearInterval(this._cntI);
  }

  showPause() {
    this.hidePause();
    const p = el('div', 'pause osd interactive', `<div class="label">PAUSE ❚❚</div><div class="items"></div>`);
    this.root.appendChild(p);
    this.pauseEl = p;
    this._list(p.querySelector('.items'), [
      { label: 'Resume', fn: () => this.game.resume() },
      { label: 'Journal', fn: () => this.showJournal() },
      { label: 'Settings', fn: () => this.showSettings() },
      { label: 'Eject tape', fn: () => this.game.quitToMenu() },
    ]);
  }
  hidePause() {
    if (this.pauseEl) this.pauseEl.remove();
    this.pauseEl = null;
  }

  // ---------- panels ----------
  _panel(cls, html) {
    this.closePanel();
    const p = el('div', 'panel osd interactive ' + cls, `<div class="box">${html}</div>`);
    this.root.appendChild(p);
    this.panelEl = p;
    p.addEventListener('click', (e) => {
      if (e.target === p) this.closePanel();
    });
    return p;
  }
  closePanel() {
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
      if (this.modal === 'inventory' || this.modal === 'note') {
        this.modal = null;
        if (this.game.state === 'play' || this.game.state === 'intro') {
          if (!this.game.paused) this.game.input.lock();
        }
      }
      if (this.modal === 'panel') this.modal = this.game.paused ? null : null;
      this._restoreList();
    }
  }
  _restoreList() {
    // re-select the underlying menu for keyboard nav
    const host = this.pauseEl || this.menuEl;
    if (host) {
      const items = [...host.querySelectorAll('.item')];
      this.items = items.map((e, i) => ({ el: e, fn: () => e.click(), disabled: e.classList.contains('disabled') }));
      this._select(Math.max(0, this.items.findIndex((x) => !x.disabled)));
    }
  }
  closeAll() {
    this.closePanel();
    this.modal = null;
  }

  showSettings() {
    const s = this.game.settings;
    const p = this._panel(
      'settings',
      `<h2>Settings</h2>
      <div class="row"><span>Mouse sensitivity</span><input type="range" min="0.2" max="3" step="0.05" data-k="sensitivity"></div>
      <div class="row"><span>Volume</span><input type="range" min="0" max="1" step="0.01" data-k="volume"></div>
      <div class="row"><span>Field of view</span><input type="range" min="55" max="100" step="1" data-k="fov"></div>
      <div class="row"><span>Graphics</span><span><span class="opt" data-q="low">low</span><span class="opt" data-q="medium">medium</span><span class="opt" data-q="high">high</span></span></div>
      <div class="row"><span>Film effects</span><span><span class="opt" data-b="filmEffects" data-v="1">on</span><span class="opt" data-b="filmEffects" data-v="0">off</span></span></div>
      <div class="row"><span>Head bob</span><span><span class="opt" data-b="headBob" data-v="1">on</span><span class="opt" data-b="headBob" data-v="0">off</span></span></div>
      <div class="row"><span>Invert Y</span><span><span class="opt" data-b="invertY" data-v="1">on</span><span class="opt" data-b="invertY" data-v="0">off</span></span></div>
      <div class="item sel" data-close="1">Back</div>`
    );
    p.querySelectorAll('input[type=range]').forEach((r) => {
      r.value = s.get(r.dataset.k);
      r.addEventListener('input', () => s.set(r.dataset.k, parseFloat(r.value)));
    });
    const refresh = () => {
      p.querySelectorAll('[data-q]').forEach((o) => o.classList.toggle('on', s.get('quality') === o.dataset.q));
      p.querySelectorAll('[data-b]').forEach((o) => o.classList.toggle('on', !!s.get(o.dataset.b) === (o.dataset.v === '1')));
    };
    p.querySelectorAll('[data-q]').forEach((o) => o.addEventListener('click', () => { s.set('quality', o.dataset.q); refresh(); }));
    p.querySelectorAll('[data-b]').forEach((o) => o.addEventListener('click', () => { s.set(o.dataset.b, o.dataset.v === '1'); refresh(); }));
    p.querySelector('[data-close]').addEventListener('click', () => this.closePanel());
    refresh();
    this.items = [];
  }

  showJournal(tab = 'levels') {
    const c = this.game.codex;
    const tabs = { levels: 'Places', entities: 'Things seen', notes: 'Notes', endings: 'Endings' };
    let body = '';
    if (tab === 'levels') {
      for (const [id, e] of Object.entries(CODEX.levels)) {
        const known = c.levels.has(id);
        body += `<div class="entry ${known ? '' : 'locked'}"><div class="name">${known ? e.name : '— — —'}</div>${known ? e.text : ''}</div>`;
      }
    } else if (tab === 'entities') {
      for (const [id, e] of Object.entries(CODEX.entities)) {
        const known = c.entities.has(id);
        body += `<div class="entry ${known ? '' : 'locked'}"><div class="name">${known ? e.name : '— — —'}</div>${known ? e.text : ''}</div>`;
      }
    } else if (tab === 'notes') {
      const found = NOTES.filter((n) => c.notes.has(n.id));
      body += `<div class="entry">${found.length} / ${NOTES.length} found</div>`;
      for (const n of found) body += `<div class="entry"><div class="name">${n.title}</div>${n.text.replace(/\n/g, '<br>')}</div>`;
    } else {
      for (const [id, e] of Object.entries(CODEX.endings)) {
        const known = c.endings.has(id);
        body += `<div class="entry ${known ? '' : 'locked'}"><div class="name">${known ? e.name : '— — —'}</div>${known ? e.text : ''}</div>`;
      }
    }
    const p = this._panel(
      'journal',
      `<h2>Journal</h2><div class="tabs">${Object.entries(tabs).map(([k, v]) => `<span class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${v}</span>`).join('')}</div>${body}<div class="item sel" data-close="1">Back</div>`
    );
    p.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => this.showJournal(t.dataset.tab)));
    p.querySelector('[data-close]').addEventListener('click', () => this.closePanel());
    this.items = [];
  }

  toggleInventory() {
    if (this.modal === 'inventory') {
      this.closePanel();
      return;
    }
    this.openInventory();
  }

  openInventory() {
    const g = this.game, p = g.player;
    const bat = p.battery > 0.66 ? 'full' : p.battery > 0.33 ? 'half' : p.battery > 0.1 ? 'low' : p.battery > 0 ? 'nearly dead' : 'dead';
    const notes = p.inv.notes.map((id) => NOTES.find((n) => n.id === id)).filter(Boolean);
    const panel = this._panel(
      'inventory',
      `<h2>Pockets</h2>
      <div class="slot interactive" data-use="almond"><span>Almond Water × ${p.inv.almond}</span><span class="key">[Q] drink</span></div>
      <div class="slot interactive" data-use="battery"><span>Batteries × ${p.inv.batteries}</span><span class="key">[R] replace</span></div>
      <div class="slot"><span>Flashlight</span><span class="key">${bat}</span></div>
      <div class="slot"><span>Notes</span><span class="key">${notes.length}</span></div>
      ${notes.map((n) => `<div class="item" data-note="${n.id}">${n.title}</div>`).join('')}
      <div class="item" data-journal="1">Journal</div>
      <div class="hint">TAB to close</div>`
    );
    this.modal = 'inventory';
    g.input.unlock();
    panel.querySelector('[data-use=almond]').addEventListener('click', () => { if (g.useAlmond()) this.openInventory(); });
    panel.querySelector('[data-use=battery]').addEventListener('click', () => { if (g.useBattery()) this.openInventory(); });
    panel.querySelectorAll('[data-note]').forEach((e) => e.addEventListener('click', () => {
      const n = NOTES.find((x) => x.id === e.dataset.note);
      this.showNote(n);
    }));
    panel.querySelector('[data-journal]').addEventListener('click', () => {
      this.modal = 'panel-inv';
      this.showJournal();
      this.modal = 'inventory';
    });
    this.items = [];
  }

  showNote(n) {
    this.closePanel();
    const p = el('div', 'note interactive', `<div class="paper"><div class="t">${n.title}</div>${n.text}</div><div class="close osd">click or E to put it down</div>`);
    this.root.appendChild(p);
    this.panelEl = p;
    this.modal = 'note';
    this.game.input.unlock();
    p.addEventListener('click', () => this.closePanel());
  }

  // ---------- endings ----------
  showEnding(title, text, onDone) {
    const e = el('div', 'ending osd interactive', `<div class="e1">${title}</div><div class="e2">${text}</div><div class="e3">▶ rewind</div>`);
    this.root.appendChild(e);
    requestAnimationFrame(() => e.classList.add('show'));
    e.querySelector('.e3').addEventListener('click', () => {
      e.remove();
      onDone();
    });
    this.endingEl = e;
  }

  handleKey(code) {
    if (this.panelEl) {
      if (code === 'Escape' || (code === 'Tab' && this.modal === 'inventory') || (code === 'KeyE' && this.modal === 'note')) {
        this.closePanel();
        return true;
      }
      if (code === 'KeyQ' && this.modal === 'inventory') {
        if (this.game.useAlmond()) this.openInventory();
        return true;
      }
      if (code === 'KeyR' && this.modal === 'inventory') {
        if (this.game.useBattery()) this.openInventory();
        return true;
      }
      return this.modal !== null;
    }
    if ((this.menuEl || this.pauseEl) && this.items.length) {
      if (code === 'ArrowDown' || code === 'KeyS') {
        let i = this.sel;
        do i = (i + 1) % this.items.length;
        while (this.items[i].disabled);
        this._select(i);
        return true;
      }
      if (code === 'ArrowUp' || code === 'KeyW') {
        let i = this.sel;
        do i = (i - 1 + this.items.length) % this.items.length;
        while (this.items[i].disabled);
        this._select(i);
        return true;
      }
      if (code === 'Enter' || code === 'Space') {
        const it = this.items[this.sel];
        if (it && !it.disabled) it.fn();
        return true;
      }
      if (code === 'Escape' && this.pauseEl) {
        this.game.resume();
        return true;
      }
      return !!this.pauseEl;
    }
    return false;
  }
}
