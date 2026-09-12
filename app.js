/* Classic scripts and relative asset paths support opening index.html directly. */
(() => {
  'use strict';
  const data = window.FOREVER_DATA;
  const calc = window.FOREVER_CALCULATOR;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const storageKey = 'forever-druid-screenshots-v2';
  let points = {}, rules = { ...calc.defaults }, selected = calc.talents[0].id;
  let undoStack = [], query = '';
  let initialMessage = '';
  try {
    const code = location.hash.startsWith('#FF2.') ? location.hash.slice(1) : localStorage.getItem(storageKey);
    if (code) ({ points, rules } = calc.decode(code));
  } catch (error) { initialMessage = `Starting a fresh build. ${error.message}`; }

  function save() {
    try { localStorage.setItem(storageKey, calc.encode(points, rules)); } catch (_) { /* File/private storage may be unavailable. */ }
  }
  function status(message) { $('#status').textContent = message; }
  function commit(next) {
    undoStack.push({ points: { ...points }, rules: { ...rules } });
    if (undoStack.length > 100) undoStack.shift();
    points = next;
    save(); update();
  }

  $('#root').innerHTML = `<main>
    <header><div class="brand"><span class="crest" aria-hidden="true">❦</span><div><small>WORLD OF WARCRAFT</small><strong>FOREVER</strong></div></div><span class="header-label">DRUID TALENTS</span><button class="ghost" id="share">Export / import build ↗</button></header>
    <section class="hero"><div><p class="eyebrow">DRUID TALENT CALCULATOR</p><h1>Walk the <em>Wild Path.</em></h1><p class="intro">Balance. Feral Combat. Restoration. One build.</p></div><div class="points"><span>Talent points</span><b id="total"></b><div class="meter"><i id="meter"></i></div><small id="remaining"></small></div></section>
    <div class="toolbar"><label class="search-label">Find a talent <input id="search" type="search" placeholder="Name or effect…" autocomplete="off"></label><span>Click to add · Right-click to refund</span><button class="ghost" id="undo">Undo</button><button class="ghost" id="reset">Reset build</button></div>
    <p id="status" role="status" aria-live="polite"></p>
    <section class="workspace"><div class="trees-scroll"><div class="trees" id="trees" aria-label="All Druid talent trees"></div></div><aside><section class="tooltip" id="inspector" aria-label="Talent details"></section><section class="summary"><p class="eyebrow">YOUR BUILD</p><div class="split" id="split"></div><div id="build-list"></div></section></aside></section>
    <details class="rules"><summary>Calculator rules</summary><div class="rule-content"><p>Talent descriptions show the first-rank effect; higher-rank effects have not been extrapolated. This preview planner defaults to an assumed 51-point budget, five points in earlier rows per tier, and maximum rank in arrow prerequisites. These rules are adjustable below.</p><div class="rule-controls"><label>Point budget <input id="budget" type="number" min="1" max="200" value="${rules.budget}"></label><label><input id="gates" type="checkbox" ${rules.gates ? 'checked' : ''}> Enforce assumed row and prerequisite rules</label><button class="ghost" id="apply-rules">Apply rules</button></div><p>Moonkin Aura and Leader of the Pack have exclusive aura effects. The planner does not treat this as a ban on learning both talents.</p></div></details>
    <footer class="page-foot">Forever Druid · 17 Balance / 19 Feral Combat / 16 Restoration · Game artwork © Blizzard Entertainment</footer>
    <dialog id="build-dialog"><div class="dialog-head"><h2>Share your build</h2><button class="ghost" data-close="build-dialog" aria-label="Close build sharing">×</button></div><p>Copy this code, or paste another Forever Druid build code to import it.</p><label for="build-code">Build code</label><textarea id="build-code" rows="4" spellcheck="false"></textarea><div class="actions"><button id="copy-code">Copy code</button><button id="import-code">Import code</button></div><p id="share-status" role="status"></p></dialog>
  </main>`;

  function renderTrees() {
    $('#trees').innerHTML = data.trees.map(tree => {
      const arrows = tree.talents.filter(t => t.prerequisite).map(t => {
        const parent = calc.byId[t.prerequisite];
        const x = (t.col - 0.5) * 100;
        return `<path data-prerequisite="${t.id}" d="M ${x} ${(parent.row - 1) * 100 + 93} V ${(t.row - 1) * 100 + 2}" marker-end="url(#arrow-${tree.id})"/>`;
      }).join('');
      return `<section class="tree-panel" style="--tree:${tree.color}" aria-labelledby="heading-${tree.id}"><div class="tree-head"><img class="tree-icon" src="${tree.icon}" alt=""><div><h2 id="heading-${tree.id}">${tree.name}</h2><small>${tree.talents.length} talents</small></div><b id="count-${tree.id}">0</b></div><div class="tree-grid"><svg class="connections" viewBox="0 0 400 700" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="arrow-${tree.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${arrows}</svg>${tree.talents.map(t => `<button class="node" data-id="${t.id}" style="grid-column:${t.col};grid-row:${t.row}" aria-describedby="inspector" title="${escape(t.name + '\n' + t.description)}"><span class="orb"><img src="${t.icon}" alt="" draggable="false"><b class="rank"></b></span><span class="node-name">${escape(t.name)}</span></button>`).join('')}</div></section>`;
    }).join('');
    $('#trees').querySelectorAll('.node').forEach(node => {
      const id = node.dataset.id;
      node.addEventListener('mouseenter', () => inspect(id));
      node.addEventListener('focus', () => inspect(id));
      node.addEventListener('click', event => learn(id, event.shiftKey ? -1 : 1));
      node.addEventListener('contextmenu', event => { event.preventDefault(); learn(id, -1); });
      node.addEventListener('keydown', event => {
        if (['Backspace', 'Delete', '-'].includes(event.key)) { event.preventDefault(); learn(id, -1); }
      });
    });
  }
  function inspect(id) {
    selected = id;
    updateInspector();
    $('#trees').querySelectorAll('.node').forEach(node => node.classList.toggle('inspected', node.dataset.id === selected));
  }
  function updateInspector() {
    const t = calc.byId[selected];
    const rank = points[t.id] || 0, lock = calc.requirements(points, t, rules);
    const details = value => value?.length ? `<div class="spell-details">${value.map(item => `<span>${escape(item)}</span>`).join('')}</div>` : '';
    const description = value => value.split('\n\n').map(p => `<p class="effect">${escape(p)}</p>`).join('');
    $('#inspector').innerHTML = `<small class="eyebrow">${escape(data.trees.find(tree => tree.id === t.tree).name)} · ROW ${t.row}</small><div class="talent-heading"><img src="${t.icon}" alt=""><h3>${escape(t.name)}</h3></div><div class="rank-line"><b>Rank ${rank}/${t.max}</b><span>${t.type}</span></div><p class="capture-label">First-rank effect</p>${details(t.details)}${t.requires ? `<p class="form-requirement">Requires ${escape(t.requires)}</p>` : ''}${description(t.description)}${t.alternate ? `<h4>${escape(t.alternate.name)}</h4>${details(t.alternate.details)}<p class="form-requirement">Requires ${escape(t.alternate.requires)}</p>${description(t.alternate.description)}` : ''}${t.prerequisite ? `<p class="prerequisite">Requires <strong>${escape(calc.byId[t.prerequisite].name)}</strong></p>` : ''}${lock ? `<p class="lock-reason">${escape(lock)}</p>` : ''}<div class="actions"><button id="add-rank" ${rank === t.max || lock || calc.total(points) >= rules.budget ? 'disabled' : ''}>+ Add point</button><button id="refund-rank" class="ghost" ${!rank ? 'disabled' : ''}>− Refund</button></div>`;
    $('#add-rank').onclick = () => learn(t.id, 1);
    $('#refund-rank').onclick = () => learn(t.id, -1);
  }
  function learn(id, delta) {
    selected = id;
    const result = calc.change(points, id, delta, rules);
    if (result.error) { status(result.error); updateInspector(); return; }
    commit(result.points);
    status(`${calc.byId[id].name}: ${points[id] || 0}/${calc.byId[id].max}.`);
  }
  function update() {
    const used = calc.total(points);
    $('#total').innerHTML = `${used}<i>/ ${rules.budget}</i>`;
    $('#meter').style.width = `${Math.min(100, used / rules.budget * 100)}%`;
    $('#remaining').textContent = `${rules.budget - used} points remaining`;
    data.trees.forEach(t => {
      $(`#count-${t.id}`).textContent = calc.treeTotal(points, t.id);
      $(`#count-${t.id}`).setAttribute('aria-label', `${calc.treeTotal(points, t.id)} points in ${t.name}`);
    });
    $('#trees').querySelectorAll('.node').forEach(node => {
      const t = calc.byId[node.dataset.id], rank = points[t.id] || 0;
      node.querySelector('.rank').textContent = `${rank}/${t.max}`;
      node.setAttribute('aria-label', `${t.name}, rank ${rank} of ${t.max}`);
      node.classList.toggle('learned', rank > 0);
      node.classList.toggle('maxed', rank === t.max);
      node.classList.toggle('locked', Boolean(calc.requirements(points, t, rules)));
      node.classList.toggle('inspected', t.id === selected);
      node.classList.toggle('search-dim', query !== '' && !`${t.name} ${t.description}`.toLowerCase().includes(query));
    });
    $('#trees').querySelectorAll('[data-prerequisite]').forEach(path => {
      const parent = calc.byId[calc.byId[path.dataset.prerequisite].prerequisite];
      path.classList.toggle('ready', (points[parent.id] || 0) === parent.max);
    });
    $('#split').innerHTML = data.trees.map(t => `<div><span style="background:${t.color}"></span>${t.name}<b>${calc.treeTotal(points, t.id)}</b></div>`).join('');
    $('#build-list').innerHTML = used ? `<ul>${calc.talents.filter(t => points[t.id]).map(t => `<li><button data-inspect="${t.id}">${escape(t.name)}</button><b>${points[t.id]}/${t.max}</b></li>`).join('')}</ul>` : '<p class="empty">Choose talents from any tree. Hover or focus an icon to see its effect.</p>';
    $('#build-list').querySelectorAll('[data-inspect]').forEach(button => button.onclick = () => {
      inspect(button.dataset.inspect);
      $(`[data-id="${button.dataset.inspect}"]`).focus({ preventScroll: true });
    });
    $('#undo').disabled = !undoStack.length;
    $('#reset').disabled = !used;
    $('#budget').value = rules.budget;
    $('#gates').checked = rules.gates;
    updateInspector();
  }
  $('#search').oninput = event => { query = event.target.value.trim().toLowerCase(); update(); };
  $('#reset').onclick = () => { commit({}); status('Build reset. Undo restores it.'); };
  $('#undo').onclick = () => {
    const previous = undoStack.pop();
    if (!previous) return;
    ({ points, rules } = previous);
    save(); update(); status('Previous build restored.');
  };
  $('#apply-rules').onclick = () => {
    const nextRules = { budget: Number($('#budget').value), gates: $('#gates').checked };
    const error = calc.validate(points, nextRules);
    if (error) { status(error); return; }
    undoStack.push({ points: { ...points }, rules: { ...rules } });
    rules = nextRules;
    save(); update(); status('Calculator rules updated.');
  };
  $('#share').onclick = () => { $('#build-code').value = calc.encode(points, rules); $('#share-status').textContent = ''; $('#build-dialog').showModal(); };
  $('#copy-code').onclick = async () => {
    try { await navigator.clipboard.writeText($('#build-code').value); $('#share-status').textContent = 'Build code copied.'; }
    catch (_) { $('#build-code').focus(); $('#build-code').select(); $('#share-status').textContent = 'Press Command+C (Mac) or Ctrl+C to copy the selected code.'; }
  };
  $('#import-code').onclick = () => {
    try {
      const imported = calc.decode($('#build-code').value);
      undoStack.push({ points: { ...points }, rules: { ...rules } });
      ({ points, rules } = imported);
      save(); update(); $('#build-dialog').close(); status('Build imported.');
    } catch (error) { $('#share-status').textContent = error.message; }
  };
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(`#${button.dataset.close}`).close());
  renderTrees(); update(); status(initialMessage);
})();
