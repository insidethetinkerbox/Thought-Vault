// Thought Vault. Plain JavaScript, no build step. Thoughts are saved in this browser and, once connected,
// kept in step with your private Google Sheet so every device sees the same thoughts.
(function () {
  'use strict';
  const T = window.Tagger;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  // ---------- Saving in this browser ----------
  const KEY = 'tv-thoughts';
  const SHELF_KEY = 'tv-shelves';
  const SHELF_UPD_KEY = 'tv-shelves-updated';
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  const state = {
    thoughts: [],
    shelves: [],
    model: null,
    tagCounts: {},
    f: { q: '', kind: 'all', shelf: 'all', tag: '', pinned: false, archived: false },
  };

  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function now() { return new Date().toISOString(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function cloneDefaults() { return T.DEFAULT_SHELVES.map((s) => ({ id: s.id, name: s.name, short: s.short, words: s.words })); }
  function shelfById(id) { return state.shelves.find((s) => s.id === id); }
  function kindById(id) { return T.KINDS.find((k) => k.id === id) || T.KINDS[3]; }

  function save() {
    const ok = store.set(KEY, state.thoughts);
    if (!ok) toast('I couldn’t save to this browser. Is it in private browsing mode?', true);
    derive();
    syncSoon();
  }
  function plainShelves() { return state.shelves.map(({ _kw, ...s }) => s); }
  // changed = true when I edited the shelves here; false when they've just arrived from the Sheet.
  function saveShelves(changed = true) {
    store.set(SHELF_KEY, plainShelves());
    if (changed) { store.set(SHELF_UPD_KEY, now()); syncSoon(); }
  }

  // Things worked out from the thoughts: the learned word model and how often each tag is used.
  function derive() {
    state.model = T.buildModel(state.thoughts);
    const counts = {};
    for (const t of state.thoughts) if (!t.archived) for (const tag of t.tags) counts[tag] = (counts[tag] || 0) + 1;
    state.tagCounts = counts;
    $('#allTags').innerHTML = Object.keys(counts).sort().map((t) => `<option value="${esc(t)}">`).join('');
  }

  function analyse(text) { return T.analyse(text, { shelves: state.shelves, model: state.model, tagCounts: state.tagCounts }); }

  function normalise(t) {
    return {
      id: t.id || uid(),
      text: String(t.text || ''),
      shelf: t.shelf && shelfById(t.shelf) ? t.shelf : '',
      shelfBy: t.shelfBy === 'you' ? 'you' : 'auto',
      kind: T.KINDS.some((k) => k.id === t.kind) ? t.kind : 'note',
      tags: Array.isArray(t.tags) ? t.tags.map(T.slug).filter(Boolean) : [],
      pinned: !!t.pinned, done: !!t.done, archived: !!t.archived,
      created: t.created || now(), updated: t.updated || t.created || now(),
    };
  }

  // ---------- Quick capture ----------
  const cap = { touchedShelf: false, touchedKind: false, tags: [], removed: new Set(), userTags: [] };
  const capText = $('#capText');

  function fillShelfSelect(sel) {
    sel.innerHTML = `<option value="">Unsorted (not sure yet)</option>` +
      state.shelves.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  }
  function fillKindSelect(sel) { sel.innerHTML = T.KINDS.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join(''); }

  let capTimer = 0;
  function onCapInput() {
    clearTimeout(capTimer);
    capTimer = setTimeout(updateCapSuggest, 120);
    $('#fileBtn').disabled = !capText.value.trim();
  }

  function updateCapSuggest() {
    const text = capText.value;
    const blank = !text.trim();
    $('#capSuggest').classList.toggle('idle', blank);
    if (blank) { cap.tags = cap.userTags.slice(); renderCapTags(); return; }
    const g = analyse(text);
    if (!cap.touchedShelf) $('#capShelf').value = g.shelf;
    if (!cap.touchedKind) $('#capKind').value = g.kind;
    const auto = g.tags.filter((t) => !cap.removed.has(t));
    cap.tags = Array.from(new Set(cap.userTags.concat(auto))).slice(0, 6);
    renderCapTags();
  }

  function renderCapTags() {
    tagEditor($('#capTags'), cap.tags, [], {
      add(tag) { if (!cap.userTags.includes(tag)) cap.userTags.push(tag); cap.removed.delete(tag); updateCapSuggest(); },
      remove(tag) { cap.userTags = cap.userTags.filter((t) => t !== tag); cap.removed.add(tag); updateCapSuggest(); },
    });
  }

  function resetCapture() {
    capText.value = '';
    cap.touchedShelf = cap.touchedKind = false;
    cap.tags = []; cap.userTags = []; cap.removed = new Set();
    $('#capShelf').value = '';
    $('#capKind').value = 'idea';
    $('#fileBtn').disabled = true;
    updateCapSuggest();
  }

  function fileThought() {
    const text = capText.value.trim();
    if (!text) return;
    updateCapSuggest();
    const shelf = $('#capShelf').value;
    const t = normalise({
      text, shelf, shelfBy: shelf ? 'you' : 'auto',
      kind: $('#capKind').value, tags: cap.tags,
      created: now(), updated: now(),
    });
    state.thoughts.unshift(t);
    save();
    resetCapture();
    render();
    const s = shelfById(t.shelf);
    toast(s ? `Filed on ${s.name}` : 'Filed in Unsorted. Pick a shelf when you’re ready.', false, () => {
      state.thoughts = state.thoughts.filter((x) => x.id !== t.id);
      save(); render();
      capText.value = text; onCapInput(); capText.focus();
    });
  }

  // ---------- Tag editor (used in capture and in the open thought) ----------
  function tagEditor(box, tags, suggestions, on) {
    box.innerHTML =
      tags.map((t) => `<span class="tag">#${esc(t)}<button type="button" data-rm="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('') +
      suggestions.filter((t) => !tags.includes(t)).map((t) => `<button type="button" class="tag sug" data-sug="${esc(t)}" title="Add this tag">+ #${esc(t)}</button>`).join('') +
      `<input class="tag-add" list="allTags" placeholder="+ tag" aria-label="Add a tag" enterkeyhint="done" autocomplete="off">`;
    box.onclick = (e) => {
      const rm = e.target.closest('[data-rm]'); if (rm) { on.remove(rm.dataset.rm); return; }
      const sg = e.target.closest('[data-sug]'); if (sg) on.add(sg.dataset.sug);
    };
    const input = $('.tag-add', box);
    const commit = () => {
      const v = T.slug(input.value);
      input.value = '';
      if (v) { on.add(v); setTimeout(() => { const i = $('.tag-add', box); if (i) i.focus(); }, 0); }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); commit(); }
      else if (e.key === 'Backspace' && !input.value && tags.length) on.remove(tags[tags.length - 1]);
    });
    input.addEventListener('change', () => { if (input.value && state.tagCounts[T.slug(input.value)]) commit(); });
    input.addEventListener('blur', () => { if (input.value.trim()) commit(); });
  }

  // ---------- Filtering ----------
  function visible() {
    const f = state.f;
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    return state.thoughts.filter((t) => {
      if (f.archived ? !t.archived : t.archived) return false;
      if (f.pinned && !t.pinned) return false;
      if (f.kind !== 'all' && t.kind !== f.kind) return false;
      if (f.shelf !== 'all' && t.shelf !== f.shelf) return false;
      if (f.tag && !t.tags.includes(f.tag)) return false;
      if (words.length) {
        const s = shelfById(t.shelf);
        const hay = (t.text + ' ' + t.tags.map((x) => '#' + x).join(' ') + ' ' + (s ? s.name : 'unsorted') + ' ' + kindById(t.kind).name).toLowerCase();
        return words.every((w) => hay.includes(w));
      }
      return true;
    });
  }

  function sortThoughts(list) {
    return list.slice().sort((a, b) =>
      (b.pinned - a.pinned) || (a.done - b.done) || (b.created < a.created ? -1 : b.created > a.created ? 1 : 0));
  }

  // ---------- Rendering ----------
  function render() { renderStats(); renderChips(); renderLibrary(); }

  function tile(label, n, cls, pressed, key) {
    return `<button type="button" class="tile ${cls || ''}" data-tile="${key}" aria-pressed="${pressed}"><span class="t">${label}</span><span class="n">${n}</span></button>`;
  }

  function renderStats() {
    const live = state.thoughts.filter((t) => !t.archived);
    const open = live.filter((t) => t.kind === 'todo' && !t.done).length;
    const ideas = live.filter((t) => t.kind === 'idea').length;
    const unsorted = live.filter((t) => !t.shelf).length;
    const f = state.f;
    const plain = f.kind === 'all' && f.shelf === 'all' && !f.tag && !f.pinned && !f.archived && !f.q;
    $('#stats').innerHTML =
      tile('Thoughts', live.length, '', plain, 'all') +
      tile('To do · open', open, '', f.kind === 'todo', 'todo') +
      tile('Ideas', ideas, '', f.kind === 'idea', 'idea') +
      tile('Unsorted', unsorted, unsorted ? 'low' : 'out', f.shelf === '', 'unsorted') +
      `<div class="tile pick"><span class="t">Shelf</span><div class="pick-row">
        <label class="sr" for="shelfPick">Show one shelf</label>
        <select id="shelfPick"><option value="all">All shelves</option><option value="">Unsorted</option>${state.shelves.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div></div>`;
    const pick = $('#shelfPick');
    pick.value = f.shelf;
    pick.onchange = () => { state.f.shelf = pick.value; render(); };
  }

  function renderChips() {
    const f = state.f;
    const live = state.thoughts.filter((t) => !t.archived);
    const count = (k) => live.filter((t) => t.kind === k).length;
    let h = `<button type="button" class="chip" data-kind="all" aria-pressed="${f.kind === 'all'}">All kinds</button>`;
    for (const k of T.KINDS) h += `<button type="button" class="chip" data-kind="${k.id}" aria-pressed="${f.kind === k.id}">${esc(k.plural)} <span class="c">${count(k.id)}</span></button>`;
    h += `<span class="sep" aria-hidden="true"></span>`;
    h += `<button type="button" class="chip" data-flag="pinned" aria-pressed="${f.pinned}">Pinned</button>`;
    h += `<button type="button" class="chip" data-flag="archived" aria-pressed="${f.archived}">Put away <span class="c">${state.thoughts.length - live.length}</span></button>`;
    if (f.tag) h += `<button type="button" class="chip tagf" data-cleartag aria-label="Stop filtering by tag ${esc(f.tag)}">#${esc(f.tag)} ×</button>`;
    $('#chips').innerHTML = h;
  }

  function niceDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const today = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(today) - day(d)) / 864e5);
    if (diff === 0) return 'Today ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-GB', d.getFullYear() === today.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function splitTitle(text) {
    const lines = text.trim().split(/\n/);
    let title = lines[0].replace(/^[-*•#\s]+/, '').replace(/^\[[ x]\]\s*/i, '');
    let rest = lines.slice(1).join('\n').trim();
    if (title.length > 140) {
      const cut = title.lastIndexOf(' ', 120);
      const at = cut > 60 ? cut : 120;
      rest = ('…' + title.slice(at).trim() + (rest ? '\n' + rest : ''));
      title = title.slice(0, at).trim() + '…';
    }
    return { title, rest };
  }

  function cardHTML(t, guess) {
    const s = shelfById(t.shelf);
    const k = kindById(t.kind);
    const { title, rest } = splitTitle(t.text);
    const isTodo = t.kind === 'todo';
    let h = `<article class="card${t.pinned ? ' pinned' : ''}${t.done ? ' done' : ''}">
      <button type="button" class="card-main" data-open="${esc(t.id)}">
        <span class="card-top"><span class="kind ${k.id}">${esc(k.name)}</span>${t.pinned ? '<span class="pin">· Pinned</span>' : ''}<span class="cdate">${esc(niceDate(t.created))}</span></span>
        <span class="ctitle">${esc(title)}</span>
        ${rest ? `<span class="ctext">${esc(rest)}</span>` : ''}
      </button>`;
    if (t.tags.length || isTodo) {
      h += `<div class="cfoot"><div class="ctags">${t.tags.map((x) => `<button type="button" class="ctag" data-tag="${esc(x)}">#${esc(x)}</button>`).join('')}</div>`;
      if (isTodo) h += `<button type="button" class="tick" data-tick="${esc(t.id)}" aria-pressed="${t.done}" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}" title="${t.done ? 'Done. Tap to undo' : 'Mark as done'}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg></button>`;
      h += `</div>`;
    }
    if (!t.shelf) {
      h += `<div class="sorter"><span class="sorter-label">Which shelf?</span><div class="shelf-btns">` +
        state.shelves.map((x) => `<button type="button" class="shelf-btn${x.id === guess ? ' suggested' : ''}" data-shelve="${esc(t.id)}" data-to="${esc(x.id)}"${x.id === guess ? ' title="My best guess"' : ''}>${esc(x.short || x.name)}</button>`).join('') +
        `</div></div>`;
    }
    return h + `</article>`;
  }

  function sectionHTML(id, name, list, note) {
    const open = list.filter((t) => t.kind === 'todo' && !t.done).length;
    const sum = `${list.length} thought${list.length === 1 ? '' : 's'}${open ? ` · ${open} to do` : ''}`;
    const cards = list.map((t) => cardHTML(t, id ? '' : analyse(t.text).shelfHint)).join('');
    return `<section class="section" aria-labelledby="sec-${esc(id || 'unsorted')}"><div class="section-head"><h2 id="sec-${esc(id || 'unsorted')}">${esc(name)}</h2><span class="sum">${sum}</span></div>${note ? `<p class="section-note">${note}</p>` : ''}<div class="cards">${cards}</div></section>`;
  }

  function renderLibrary() {
    const lib = $('#library');
    if (isLocked()) {
      lib.innerHTML = `<div class="empty"><b>Your Vault is locked on this device</b>Enter your passcode to see your thoughts. You can still dump a thought in the box above: it’s added to your Vault once you unlock.<br><button type="button" class="btn primary" data-unlock>Unlock</button></div>`;
      return;
    }
    if (!state.thoughts.length) {
      lib.innerHTML = `<div class="empty"><b>Nothing in here yet</b>Pop your first thought in the box above. Half-baked is fine: the Vault puts it on a shelf, works out whether it’s an idea, a to-do or a question, and adds a few tags for you.</div>`;
      return;
    }
    const list = sortThoughts(visible());
    if (!list.length) {
      lib.innerHTML = `<div class="empty"><b>No thoughts match</b>Try fewer words, or tap <b style="display:inline;font-size:inherit">Thoughts</b> at the top to see everything.</div>`;
      return;
    }
    let h = '';
    const unsorted = list.filter((t) => !t.shelf);
    if (unsorted.length) h += sectionHTML('', 'Unsorted', unsorted, 'Tap a shelf to file each one. The outlined shelf is my best guess.');
    for (const s of state.shelves) {
      const items = list.filter((t) => t.shelf === s.id);
      if (items.length) h += sectionHTML(s.id, s.name, items);
    }
    lib.innerHTML = h;
  }

  // ---------- Library clicks ----------
  $('#library').addEventListener('click', (e) => {
    if (e.target.closest('[data-unlock]')) { openUnlock(); return; }
    const shelve = e.target.closest('[data-shelve]');
    if (shelve) {
      const t = state.thoughts.find((x) => x.id === shelve.dataset.shelve);
      if (!t) return;
      t.shelf = shelve.dataset.to; t.shelfBy = 'you'; t.updated = now();
      save(); render();
      const s = shelfById(t.shelf);
      toast(`Moved to ${s.name}. I’ll remember that.`);
      return;
    }
    const tick = e.target.closest('[data-tick]');
    if (tick) {
      const t = state.thoughts.find((x) => x.id === tick.dataset.tick);
      if (!t) return;
      t.done = !t.done; t.updated = now();
      save(); render();
      if (t.done) toast('Done. Nice one.');
      return;
    }
    const tag = e.target.closest('[data-tag]');
    if (tag) { state.f.tag = tag.dataset.tag; render(); window.scrollTo({ top: $('.filterbar').offsetTop - 8, behavior: 'smooth' }); return; }
    const open = e.target.closest('[data-open]');
    if (open) openDetail(open.dataset.open);
  });

  $('#stats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tile]');
    if (!b) return;
    const f = state.f;
    const k = b.dataset.tile;
    if (k === 'all') Object.assign(f, { q: '', kind: 'all', shelf: 'all', tag: '', pinned: false, archived: false });
    else if (k === 'unsorted') { f.shelf = f.shelf === '' ? 'all' : ''; f.archived = false; }
    else { f.kind = f.kind === k ? 'all' : k; f.archived = false; }
    if (k === 'all') $('#search').value = '';
    render();
  });

  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.kind) state.f.kind = b.dataset.kind;
    else if (b.dataset.flag) state.f[b.dataset.flag] = !state.f[b.dataset.flag];
    else if ('cleartag' in b.dataset) state.f.tag = '';
    render();
  });

  let searchTimer = 0;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = e.target.value.trim();
      const m = v.match(/^#([\w-]+)$/);
      if (m && state.tagCounts[T.slug(m[1])]) { state.f.tag = T.slug(m[1]); state.f.q = ''; }
      else state.f.q = v;
      renderStats(); renderChips(); renderLibrary();
    }, 120);
  });

  // ---------- One thought, opened ----------
  let editing = null;
  let dTags = [];

  function openDetail(id) {
    const t = state.thoughts.find((x) => x.id === id);
    if (!t) return;
    editing = t;
    dTags = t.tags.slice();
    $('#d-text').value = t.text;
    $('#d-shelf').innerHTML = [{ id: '', name: 'Unsorted' }].concat(state.shelves).map((s) =>
      `<label><input type="radio" name="d-shelf" value="${esc(s.id)}"${s.id === t.shelf ? ' checked' : ''}>${esc(s.name)}</label>`).join('');
    $('#d-kind').innerHTML = T.KINDS.map((k) =>
      `<label><input type="radio" name="d-kind" value="${k.id}"${k.id === t.kind ? ' checked' : ''}>${esc(k.name)}</label>`).join('');
    $('#d-pinned').checked = t.pinned;
    $('#d-done').checked = t.done;
    $('#d-doneWrap').hidden = t.kind !== 'todo';
    $('#d-dates').textContent = `Added ${new Date(t.created).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` +
      (t.updated !== t.created ? ` · changed ${new Date(t.updated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : '');
    $('#archiveBtn').textContent = t.archived ? 'Bring back' : 'Put away';
    renderDetailTags();
    showDialog($('#detail'));
  }

  function renderDetailTags() {
    const shelf = ($('input[name="d-shelf"]:checked') || {}).value || '';
    const sug = T.guessTags($('#d-text').value, state.tagCounts, shelf);
    tagEditor($('#d-tags'), dTags, sug, {
      add(tag) { if (!dTags.includes(tag)) dTags.push(tag); renderDetailTags(); },
      remove(tag) { dTags = dTags.filter((x) => x !== tag); renderDetailTags(); },
    });
  }

  $('#d-kind').addEventListener('change', () => { $('#d-doneWrap').hidden = $('input[name="d-kind"]:checked').value !== 'todo'; });
  let dTimer = 0;
  $('#d-text').addEventListener('input', () => { clearTimeout(dTimer); dTimer = setTimeout(renderDetailTags, 300); });

  $('#detailForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!editing) return;
    const text = $('#d-text').value.trim();
    if (!text) { toast('A thought needs some words. Use Delete to get rid of it.', true); return; }
    const pending = $('#d-tags .tag-add');
    if (pending && T.slug(pending.value)) dTags.push(T.slug(pending.value));
    const shelf = $('input[name="d-shelf"]:checked').value;
    Object.assign(editing, {
      text, shelf, shelfBy: shelf ? 'you' : 'auto',
      kind: $('input[name="d-kind"]:checked').value,
      tags: Array.from(new Set(dTags)),
      pinned: $('#d-pinned').checked,
      done: $('#d-done').checked,
      updated: now(),
    });
    save(); render();
    $('#detail').close();
    toast('Saved');
  });

  $('#archiveBtn').addEventListener('click', () => {
    if (!editing) return;
    const t = editing;
    t.archived = !t.archived; t.updated = now();
    save(); render();
    $('#detail').close();
    toast(t.archived ? 'Put away. Find it under “Put away”.' : 'Brought back', false, () => { t.archived = !t.archived; t.updated = now(); save(); render(); });
  });

  $('#deleteBtn').addEventListener('click', async () => {
    if (!editing) return;
    const t = editing;
    if (!(await ask('Delete this thought? This can’t be undone, so use Put away if you might want it later.', 'Delete', true))) return;
    state.thoughts = state.thoughts.filter((x) => x.id !== t.id);
    save(); render();
    $('#detail').close();
    toast('Deleted');
  });

  // ---------- Shelves editor ----------
  let draftShelves = [];
  function openShelves() {
    draftShelves = state.shelves.map((s) => ({ ...s }));
    renderShelfRows();
    showDialog($('#shelvesDlg'));
  }
  function renderShelfRows() {
    $('#shelfRows').innerHTML = draftShelves.map((s, i) => {
      const n = state.thoughts.filter((t) => t.shelf === s.id).length;
      return `<div class="shelf-row" data-i="${i}">
        <input value="${esc(s.name)}" aria-label="Shelf name" placeholder="Shelf name" data-f="name">
        <input class="short" value="${esc(s.short || '')}" aria-label="Short name" placeholder="Short name" data-f="short">
        <button type="button" class="icon-btn" data-del="${i}" aria-label="Remove ${esc(s.name)}" title="Remove shelf">×</button>
        <textarea rows="2" aria-label="Words that belong on ${esc(s.name)}" placeholder="Words that belong here, separated by spaces" data-f="words">${esc(s.words)}</textarea>
        <span class="count">${n} thought${n === 1 ? '' : 's'} on this shelf</span>
      </div>`;
    }).join('');
  }
  $('#shelfRows').addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]'); const f = e.target.dataset.f;
    if (row && f) draftShelves[+row.dataset.i][f] = e.target.value;
  });
  $('#shelfRows').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    const s = draftShelves[+b.dataset.del];
    const n = state.thoughts.filter((t) => t.shelf === s.id).length;
    if (n && !(await ask(`Remove “${s.name}”? Its ${n} thought${n === 1 ? '' : 's'} will move to Unsorted when you save.`, 'Remove', true))) return;
    draftShelves.splice(+b.dataset.del, 1);
    renderShelfRows();
  });
  $('#addShelfBtn').addEventListener('click', () => {
    draftShelves.push({ id: 's' + Date.now().toString(36), name: '', short: '', words: '' });
    renderShelfRows();
    const rows = $$('.shelf-row'); const last = rows[rows.length - 1];
    $('[data-f="name"]', last).focus();
  });
  $('#resetShelvesBtn').addEventListener('click', async () => {
    if (!(await ask('Go back to the starting shelves? Thoughts on shelves you added yourself will move to Unsorted when you save.', 'Reset'))) return;
    draftShelves = cloneDefaults();
    renderShelfRows();
  });
  $('#shelvesForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const clean = draftShelves.map((s) => ({ id: s.id, name: s.name.trim(), short: (s.short || '').trim() || s.name.trim().split(/\s|&/)[0], words: s.words.trim() }));
    if (clean.some((s) => !s.name)) { toast('Every shelf needs a name', true); return; }
    state.shelves = clean;
    const ids = new Set(clean.map((s) => s.id));
    for (const t of state.thoughts) if (t.shelf && !ids.has(t.shelf)) { t.shelf = ''; t.shelfBy = 'auto'; t.updated = now(); }
    saveShelves(); save();
    fillShelfSelect($('#capShelf'));
    updateCapSuggest();
    if (state.f.shelf !== 'all' && state.f.shelf !== '' && !ids.has(state.f.shelf)) state.f.shelf = 'all';
    render();
    $('#shelvesDlg').close();
    toast('Shelves saved');
  });

  // ---------- Backup ----------
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('#dlJson').addEventListener('click', () => {
    download(`thought-vault-backup-${stamp()}.json`, JSON.stringify({ app: 'thought-vault', version: 3, exported: now(), shelves: state.shelves.map(({ _kw, ...s }) => s), thoughts: state.thoughts }, null, 2), 'application/json');
    $('#backupMsg').textContent = 'Backup downloaded. Keep it somewhere safe, like Google Drive.';
  });
  $('#dlMd').addEventListener('click', () => {
    let md = `# Thought Vault\n\nExported ${new Date().toLocaleString('en-GB')}\n`;
    const groups = [{ id: '', name: 'Unsorted' }].concat(state.shelves);
    for (const s of groups) {
      const items = sortThoughts(state.thoughts.filter((t) => t.shelf === s.id && !t.archived));
      if (!items.length) continue;
      md += `\n## ${s.name}\n`;
      for (const t of items) {
        const k = kindById(t.kind).name;
        md += `\n### ${t.kind === 'todo' ? (t.done ? '[x] ' : '[ ] ') : ''}${splitTitle(t.text).title}\n*${k} · ${niceDate(t.created)}${t.tags.length ? ' · ' + t.tags.map((x) => '#' + x).join(' ') : ''}*\n\n${t.text}\n`;
      }
    }
    download(`thought-vault-${stamp()}.md`, md, 'text/markdown');
    $('#backupMsg').textContent = 'Markdown file downloaded.';
  });
  $('#restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const msg = $('#backupMsg');
    msg.classList.remove('bad');
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== 'thought-vault' || !Array.isArray(data.thoughts)) throw new Error('not a backup');
      const byId = new Map(state.thoughts.map((t) => [t.id, t]));
      let added = 0, updated = 0;
      if (Array.isArray(data.shelves)) for (const s of data.shelves) if (s && s.id && s.name && !shelfById(s.id)) state.shelves.push({ id: s.id, name: s.name, short: s.short || '', words: s.words || '' });
      for (const raw of data.thoughts) {
        const t = normalise(raw);
        const mine = byId.get(t.id);
        if (!mine) { state.thoughts.push(t); added++; }
        else if (t.updated > mine.updated) { Object.assign(mine, t); updated++; }
      }
      saveShelves(); save();
      fillShelfSelect($('#capShelf'));
      render();
      msg.textContent = `Done: ${added} added${updated ? `, ${updated} updated` : ''}. Nothing was deleted.`;
    } catch {
      msg.classList.add('bad');
      msg.textContent = 'That file isn’t a Thought Vault backup, so I left everything as it was.';
    }
  });

  // ---------- Voice ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const mic = $('#micBtn');
    mic.hidden = false;
    let rec = null;
    const stop = () => { if (rec) { try { rec.stop(); } catch {} } };
    mic.addEventListener('click', () => {
      if (rec) { stop(); return; }
      rec = new SR();
      rec.lang = navigator.language || 'en-GB';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (ev) => {
        let said = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) said += ev.results[i][0].transcript;
        if (said.trim()) {
          const v = capText.value;
          capText.value = v + (v && !/\s$/.test(v) ? ' ' : '') + said.trim();
          onCapInput();
        }
      };
      rec.onend = () => { rec = null; mic.classList.remove('rec'); $('span', mic).textContent = 'Speak'; };
      rec.onerror = (ev) => { if (ev.error === 'not-allowed') toast('The browser said no to the microphone. Check its permissions.', true); };
      try { rec.start(); mic.classList.add('rec'); $('span', mic).textContent = 'Stop'; } catch { rec = null; }
    });
  }


  // ---------- Sync with your private Google Sheet ----------
  // Each device keeps its own copy, so the Vault opens instantly and works offline.
  // Changes are sent to the Sheet in the background; for each thought, the newer version wins.
  const API = String((window.TV_CONFIG && window.TV_CONFIG.API_URL) || '').trim();
  const SYNCED_KEY = 'tv-synced';          // id → the version this device last agreed with the Sheet
  const SHELF_SYNCED_KEY = 'tv-shelves-synced';
  const PASS_KEY = 'tv-pass';
  const LAST_KEY = 'tv-last-sync';
  const sync = {
    pass: API ? store.get(PASS_KEY, '') : '',
    synced: store.get(SYNCED_KEY, {}) || {},
    busy: false, again: false, timer: 0, retries: 0,
    status: 'idle', last: store.get(LAST_KEY, ''), error: '',
  };
  function syncOn() { return !!API && !!sync.pass; }
  function isLocked() { return !!API && !sync.pass; }
  function syncSoon(ms) { if (!syncOn()) return; clearTimeout(sync.timer); sync.timer = setTimeout(runSync, ms == null ? 1200 : ms); }

  // Sent as plain text so the browser makes a simple request that Google accepts. Gives up after a minute.
  async function post(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const r = await fetch(API, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal });
      return await r.json();
    } catch {
      const err = new Error('No connection'); err.network = true; throw err;
    } finally { clearTimeout(timer); }
  }

  // What this device has that the Sheet doesn't: new or changed thoughts, and thoughts deleted here.
  function pending() {
    const out = state.thoughts.filter((t) => sync.synced[t.id] !== t.updated);
    const here = new Set(state.thoughts.map((t) => t.id));
    for (const id of Object.keys(sync.synced)) if (!here.has(id)) out.push({ id, deleted: true, updated: now() });
    return out;
  }
  function shelvesPending() {
    const upd = store.get(SHELF_UPD_KEY, '');
    return upd && upd !== store.get(SHELF_SYNCED_KEY, '') ? upd : '';
  }

  async function runSync() {
    if (!syncOn()) return;
    if (sync.busy) { sync.again = true; return; }
    clearTimeout(sync.timer);
    sync.busy = true;
    setSyncStatus('syncing');
    const sent = pending();
    const shelfUpd = shelvesPending();
    try {
      const r = await post({ action: 'sync', passcode: sync.pass, thoughts: sent, shelves: shelfUpd ? { list: plainShelves(), updated: shelfUpd } : null });
      if (!r || !r.ok) { const e = new Error((r && r.error) || 'Sync didn’t work.'); e.badPass = !!(r && r.badPasscode); throw e; }
      mergeFromSheet(r, shelfUpd);
      sync.retries = 0; sync.error = '';
      sync.last = now(); store.set(LAST_KEY, sync.last);
      setSyncStatus('done');
    } catch (e) {
      if (e.badPass) {
        forgetPasscode();
        toast('That passcode doesn’t work any more. Unlock again to keep syncing.', true);
        render();
      } else {
        sync.error = e.network ? '' : e.message;
        setSyncStatus('offline');
        const wait = [5, 15, 30, 60][Math.min(sync.retries++, 3)];
        sync.timer = setTimeout(runSync, wait * 1000);
      }
    } finally {
      sync.busy = false;
      if (sync.again) { sync.again = false; syncSoon(300); }
    }
  }

  function mergeFromSheet(r, sentShelfUpd) {
    let changed = false;
    // Shelves first, so thoughts on a shelf made on another device keep their shelf.
    const sh = r.shelves;
    if (sh && Array.isArray(sh.list) && sh.updated > store.get(SHELF_UPD_KEY, '')) {
      const list = sh.list.filter((x) => x && x.id && x.name).map((x) => ({ id: String(x.id), name: String(x.name), short: String(x.short || ''), words: String(x.words || '') }));
      if (list.length) {
        state.shelves = list;
        saveShelves(false);
        store.set(SHELF_UPD_KEY, sh.updated);
        store.set(SHELF_SYNCED_KEY, sh.updated);
        fillShelfSelect($('#capShelf'));
        changed = true;
      }
    } else if (sentShelfUpd && store.get(SHELF_UPD_KEY, '') === sentShelfUpd) {
      store.set(SHELF_SYNCED_KEY, sentShelfUpd);
    }

    const before = sync.synced;
    const next = {};
    const byId = new Map(state.thoughts.map((t) => [t.id, t]));
    for (const s of Array.isArray(r.thoughts) ? r.thoughts : []) {
      const id = String(s.id || '');
      if (!id) continue;
      const local = byId.get(id);
      if (s.deleted) {
        if (local && !(local.updated > s.updated)) { state.thoughts = state.thoughts.filter((t) => t.id !== id); changed = true; }
        continue;
      }
      next[id] = s.updated;
      if (!local) {
        if (before[id]) continue; // deleted here while that sync was on its way; the delete goes next time
        state.thoughts.push(normalise(s));
        changed = true;
      } else if (s.updated > local.updated) {
        Object.assign(local, normalise(s));
        changed = true;
      }
      // If this device changed it in the meantime, its newer version is sent next time.
    }
    sync.synced = next;
    store.set(SYNCED_KEY, next);
    if (changed) {
      store.set(KEY, state.thoughts);
      derive();
      render();
      if ($('#detail').open && editing && !state.thoughts.includes(editing)) $('#detail').close();
    }
    if (pending().length || shelvesPending()) syncSoon(500);
  }

  function setSyncStatus(s) {
    sync.status = s;
    const b = $('#syncBtn');
    if (!API) { b.hidden = true; return; }
    b.hidden = false;
    b.classList.toggle('offline', s === 'offline');
    b.textContent = isLocked() ? 'Unlock'
      : s === 'syncing' ? 'Syncing…'
      : s === 'offline' ? 'Offline · will sync'
      : 'Synced ✓';
    if ($('#syncDlg').open) renderSyncDialog();
  }

  function renderSyncDialog() {
    const n = pending().length;
    const when = sync.last ? new Date(sync.last).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet';
    let txt = `Your thoughts are kept in your private Google Sheet, so every device you unlock sees the same ones. Last synced: ${when}.`;
    if (sync.status === 'offline') txt += sync.error ? ` The last try didn’t work: ${sync.error}` : ' I can’t reach Google right now, so I’ll keep trying. Nothing is lost: it’s all saved on this device too.';
    if (n) txt += ` ${n} change${n === 1 ? '' : 's'} still to send.`;
    $('#syncText').textContent = txt;
  }

  function forgetPasscode() {
    sync.pass = '';
    store.del(PASS_KEY);
    setSyncStatus('idle');
  }

  function openUnlock() {
    $('#passInput').value = '';
    $('#unlockMsg').textContent = '';
    showDialog($('#unlockDlg'));
    setTimeout(() => $('#passInput').focus(), 50);
  }

  $('#unlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = $('#passInput').value.trim();
    if (!pass) return;
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    $('#unlockMsg').textContent = '';
    try {
      const r = await post({ action: 'check', passcode: pass });
      if (!r || !r.ok) throw new Error((r && r.error) || 'That didn’t work. Try again.');
      sync.pass = pass;
      store.set(PASS_KEY, pass);
      $('#unlockDlg').close();
      render();
      toast('Unlocked. Fetching your thoughts…');
      await runSync();
    } catch (err) {
      $('#unlockMsg').textContent = err.network ? 'I couldn’t reach Google. Check your connection and try again.' : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#syncBtn').addEventListener('click', () => {
    if (isLocked()) { openUnlock(); return; }
    renderSyncDialog();
    showDialog($('#syncDlg'));
  });
  $('#syncNowBtn').addEventListener('click', () => runSync());
  $('#lockBtn').addEventListener('click', async () => {
    if (syncOn()) await runSync();
    const n = pending().length;
    const msg = n
      ? `${n} change${n === 1 ? ' hasn’t' : 's haven’t'} reached your Google Sheet yet, and locking now would lose ${n === 1 ? 'it' : 'them'}. Lock anyway?`
      : 'Lock this device? Your thoughts stay safe in your Google Sheet. This device forgets them, and the passcode, until you unlock it again.';
    if (!(await ask(msg, 'Lock', n > 0))) return;
    $('#syncDlg').close();
    forgetPasscode();
    state.thoughts = [];
    sync.synced = {};
    store.del(KEY); store.del(SYNCED_KEY); store.del(LAST_KEY);
    sync.last = '';
    derive();
    render();
    toast('Locked. Unlock with your passcode to see your thoughts again.');
  });

  if (API) {
    $('#backupHint').textContent = 'Your thoughts are kept in your private Google Sheet, which is your main backup. You can also download a copy here, or restore one: a restore only adds and updates, and never deletes anything.';
    // Catch up whenever you come back to the Vault, come back online, and every minute while it's open.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncSoon(0); });
    window.addEventListener('online', () => syncSoon(0));
    setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, 60000);
  }

  // ---------- Dialogs, confirm, toast ----------
  function showDialog(d) { if (!d.open) d.showModal(); }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close();
  });
  for (const d of $$('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

  function ask(message, okLabel, danger) {
    const d = $('#confirmDlg');
    $('#confirmText').textContent = message;
    const ok = $('#confirmOk');
    ok.textContent = okLabel || 'OK';
    ok.classList.toggle('danger', !!danger);
    ok.classList.toggle('primary', !danger);
    d.returnValue = '';
    showDialog(d);
    return new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true }));
  }

  let toastTimer = 0;
  function toast(msg, bad, undo) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
    el.classList.toggle('bad', !!bad);
    if (undo) $('button', el).onclick = () => { undo(); hideToast(); };
    try { if (el.showPopover && !el.matches(':popover-open')) el.showPopover(); } catch {}
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 6000 : 3000);
  }
  function hideToast() {
    const el = $('#toast');
    el.classList.remove('show');
    setTimeout(() => { try { if (el.hidePopover && el.matches(':popover-open') && !el.classList.contains('show')) el.hidePopover(); } catch {} }, 250);
  }

  // ---------- Wiring ----------
  capText.addEventListener('input', onCapInput);
  capText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fileThought(); } });
  $('#fileBtn').addEventListener('click', fileThought);
  $('#capShelf').addEventListener('change', () => { cap.touchedShelf = true; });
  $('#capKind').addEventListener('change', () => { cap.touchedKind = true; });
  $('#shelvesBtn').addEventListener('click', openShelves);
  $('#backupBtn').addEventListener('click', () => { $('#backupMsg').textContent = ''; showDialog($('#backupDlg')); });
  $('#fab').addEventListener('click', () => { capText.scrollIntoView({ behavior: 'smooth', block: 'center' }); capText.focus({ preventScroll: true }); });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    else if (e.key === 'n') { e.preventDefault(); capText.focus(); }
  });

  // Shadow under the filter bar only once it's stuck to the top.
  const bar = $('.filterbar');
  const onScroll = () => bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= 0.5 && window.scrollY > 0);
  window.addEventListener('scroll', onScroll, { passive: true });

  // ---------- Start ----------
  state.shelves = (store.get(SHELF_KEY, null) || cloneDefaults()).filter((s) => s && s.id && s.name);
  if (!state.shelves.length) state.shelves = cloneDefaults();
  state.thoughts = (store.get(KEY, []) || []).map(normalise);
  derive();
  fillShelfSelect($('#capShelf'));
  fillKindSelect($('#capKind'));
  resetCapture();
  render();
  setSyncStatus('idle');
  if (syncOn()) runSync();
  else if (isLocked()) openUnlock();
})();
