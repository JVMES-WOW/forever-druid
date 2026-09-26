(() => {
  'use strict';
  const data = globalThis.FOREVER_RAID_DATA;
  const engine = globalThis.FOREVER_RAID_ENGINE;
  const raidState = globalThis.FOREVER_RAID_STATE;
  const bySpec = Object.fromEntries(data.specs.map(spec => [spec.id, spec]));
  const storageKey = 'forever-raid-planner-v1';
  let raidSize = 10;
  let groups = [];
  let selectedPlayer = null;
  let selectedBuff = null;
  let detailMode = 'overview';
  let dragPayload = null;
  let editingPlayer = null;
  let editingCampPlayer = null;
  let nextUid = 1;

  const $ = selector => document.querySelector(selector);
  const initials = spec => spec.name.split(/[ -]/).map(word => word[0]).join('').slice(0, 2);
  const defaultRoleLabels = { damage: 'Damage', tank: 'Tank', healer: 'Healer', hybrid: 'Damage / Tank' };
  const roleLabel = spec => spec.roleLabel || defaultRoleLabels[spec.role] || spec.role;
  const scopeLabel = scope => ({ party: 'Party buff', raid: 'Raid buff', boss: 'Boss debuff' })[scope] || 'Effect';
  const playerLabel = player => player.customName || player.name;
  const makePlayer = specId => ({ ...bySpec[specId], uid: `p${Date.now().toString(36)}-${nextUid++}`, campBuffs: [] });
  const blankGroups = size => Array.from({ length: size / data.groupSize }, () => Array(data.groupSize).fill(null));
  function hydrate(saved) {
    raidSize = data.raidSizes.includes(saved?.raidSize) ? saved.raidSize : 10;
    const validCampIds = new Set((data.campBuffs || []).map(camp => camp.id));
    groups = blankGroups(raidSize);
    (saved?.groups || []).slice(0, groups.length).forEach((group, groupIndex) => group.slice(0, 5).forEach((item, slotIndex) => {
      const specId = data.legacySpecIds[item?.specId] || item?.specId;
      if (specId && bySpec[specId]) {
        const player = makePlayer(specId);
        const campBuffs = raidSize === 5 && Array.isArray(item.campBuffs) ? [...new Set(item.campBuffs)].filter(id => validCampIds.has(id)).slice(0, 1) : [];
        groups[groupIndex][slotIndex] = { ...player, uid: item.uid || player.uid, customName: raidState.normalizeName(item.name || item.customName || ''), campBuffs };
      }
    }));
  }
  function seed() {
    const ids = ['warrior:protection','paladin:holy','druid:balance','rogue:combat','shaman:enhancement','druid:feral','priest:shadow','mage:fire','hunter:marksmanship','warlock:affliction'];
    groups = blankGroups(10);
    ids.forEach((id, index) => groups[Math.floor(index / 5)][index % 5] = makePlayer(id));
  }
  let initialStatus = '';
  function loadLocal() {
    try { const saved = JSON.parse(localStorage.getItem(storageKey)); if (saved) hydrate(saved); else seed(); } catch (_) { seed(); }
  }
  if (location.hash.startsWith(`#${raidState.prefix}`)) {
    try { hydrate(raidState.decode(location.hash.slice(1), data)); initialStatus = 'Shared raid loaded.'; }
    catch (_) { loadLocal(); initialStatus = 'Could not load shared raid.'; }
  } else loadLocal();

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ raidSize, groups: groups.map(group => group.map(player => player && ({ specId: player.id, uid: player.uid, name: player.customName || '', campBuffs: player.campBuffs || [] }))) })); } catch (_) {}
  }
  const shareSnapshot = () => ({ raidSize, groups: groups.map(group => group.map(player => player && ({ specId: player.id, name: player.customName || '', campBuffs: player.campBuffs || [] }))) });
  function setStatus(message) { $('#raid-status').textContent = message; }
  function setPlayerName(uid, value) {
    const position = locate(uid);
    if (!position) return;
    groups[position.g][position.s].customName = raidState.normalizeName(value);
    editingPlayer = null; save(); render(); setStatus('Character name saved.');
  }
  function addSpec(specId) {
    for (const group of groups) {
      const index = group.findIndex(player => !player);
      if (index !== -1) { group[index] = makePlayer(specId); selectedPlayer = group[index].uid; detailMode = 'player'; save(); render(); return; }
    }
  }
  function locate(uid) {
    for (let g = 0; g < groups.length; g++) for (let s = 0; s < 5; s++) if (groups[g][s]?.uid === uid) return { g, s };
    return null;
  }
  function place(payload, targetG, targetS) {
    if (payload.type === 'spec') groups[targetG][targetS] = makePlayer(payload.specId);
    else {
      const origin = locate(payload.uid);
      if (!origin || (origin.g === targetG && origin.s === targetS)) return;
      const target = groups[targetG][targetS];
      groups[targetG][targetS] = groups[origin.g][origin.s];
      groups[origin.g][origin.s] = target;
    }
    save(); render();
  }
  function providersLabel(players) { return players.map(playerLabel).join(', '); }
  function providerVariant(buff, player) { return buff.providerVariants?.[player?.classId] || null; }
  function detailedProviders(buff, players) {
    return players.map(player => {
      const variant = providerVariant(buff, player);
      return variant ? `${variant.name} — ${playerLabel(player)} ${player.className}` : `${playerLabel(player)} ${player.className}`;
    }).join(', ');
  }
  function campRedundancy(camp, player) {
    const position = locate(player.uid);
    if (!position) return '';
    const group = groups[position.g].filter(Boolean);
    const warnings = [];
    const duplicate = group.find(member => member.uid !== player.uid && member.campBuffs?.includes(camp.id));
    if (duplicate) warnings.push(`${camp.name} is already provided party-wide by ${playerLabel(duplicate)}.`);
    if (camp.warnWhenCovered) {
      const provider = group.find(member => camp.covers.some(id => member.provides.includes(id)));
      if (provider) {
        const effect = camp.covers.find(id => provider.provides.includes(id));
        warnings.push(`${data.buffs[effect].name} already has a full-strength class provider in this group.`);
      }
    }
    return warnings.join(' ');
  }
  function renderCampDialog() {
    const position = editingCampPlayer && locate(editingCampPlayer);
    const player = position && groups[position.g][position.s];
    if (!player) { if ($('#camp-buff-dialog').open) $('#camp-buff-dialog').close(); return; }
    $('#camp-buff-title').textContent = `Camp buff for ${playerLabel(player)}`;
    const root = $('#camp-assignment-options'); root.innerHTML = '';
    for (const camp of data.campBuffs || []) {
      const active = player.campBuffs.includes(camp.id);
      const warning = campRedundancy(camp, player);
      const button = document.createElement('button'); button.className = `camp-assignment${active ? ' active' : ''}${warning ? ' redundant' : ''}`;
      button.setAttribute('aria-pressed', String(active));
      button.innerHTML = `<img class="effect-icon" src="${data.buffs[camp.covers[0]].icon}" alt=""><span><b>${camp.name}</b><small>${camp.profession} · ${camp.covers.map(id => data.buffs[id].name).join(' / ')}</small>${warning ? `<em>⚠ ${warning}</em>` : ''}</span>`;
      button.onclick = () => {
        player.campBuffs = active ? [] : [camp.id];
        save(); render(); renderCampDialog(); setStatus(`${camp.name} ${active ? 'removed from' : 'assigned to'} ${playerLabel(player)}.`);
      };
      root.append(button);
    }
  }
  function selectedRecipients(analysis) {
    if (!selectedBuff) return new Set();
    const buff = data.buffs[selectedBuff];
    if (buff.scope !== 'party') return new Set(analysis.players.filter(player => engine.eligible(buff, player)).map(player => player.uid));
    return new Set(analysis.groupCoverage.flat().filter(item => item.buffId === selectedBuff).flatMap(item => item.recipients.map(player => player.uid)));
  }
  function renderPalette() {
    const query = $('#spec-search').value.trim().toLowerCase();
    const root = $('#spec-palette'); root.innerHTML = '';
    const classIds = [...new Set(data.specs.map(spec => spec.classId))]
      .sort((a, b) => data.specs.find(spec => spec.classId === a).className.localeCompare(data.specs.find(spec => spec.classId === b).className));
    for (const classId of classIds) {
      const specs = data.specs
        .filter(spec => spec.classId === classId && `${spec.className} ${spec.name} ${spec.role}`.toLowerCase().includes(query))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!specs.length) continue;
      const block = document.createElement('section'); block.className = 'class-block'; block.style.setProperty('--class', specs[0].color);
      block.innerHTML = `<h3 class="class-title"><i></i>${specs[0].className}</h3>`;
      for (const spec of specs) {
        const button = document.createElement('button'); button.className = 'spec-button'; button.draggable = true;
        button.innerHTML = `<img class="spec-mark" src="${spec.icon}" alt=""><span><b>${spec.name}</b><small>${roleLabel(spec)} · ${spec.provides.length} effect${spec.provides.length === 1 ? '' : 's'}</small></span>`;
        button.onclick = () => addSpec(spec.id);
        button.ondragstart = event => { dragPayload = { type: 'spec', specId: spec.id }; event.dataTransfer.effectAllowed = 'copy'; };
        block.append(button);
      }
      root.append(block);
    }
  }
  function renderGroups(analysis) {
    const root = $('#groups'); root.innerHTML = '';
    const recipients = selectedRecipients(analysis);
    const selectedProviders = new Set(selectedBuff ? (analysis.providers[selectedBuff] || []).map(player => player.uid) : []);
    groups.forEach((group, groupIndex) => {
      const card = document.createElement('section'); card.className = 'group-card';
      const occupied = group.filter(Boolean).length;
      card.innerHTML = `<div class="group-head"><h3>Group ${groupIndex + 1}</h3><span>${occupied}/5</span></div>`;
      group.forEach((player, slotIndex) => {
        const slot = document.createElement('div'); slot.className = 'slot'; slot.dataset.group = groupIndex; slot.dataset.slot = slotIndex;
        slot.ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = dragPayload?.type === 'spec' ? 'copy' : 'move'; slot.classList.add('drag-over'); };
        slot.ondragleave = () => slot.classList.remove('drag-over');
        slot.ondrop = event => { event.preventDefault(); slot.classList.remove('drag-over'); if (dragPayload) place(dragPayload, groupIndex, slotIndex); dragPayload = null; };
        if (!player) slot.textContent = 'Empty';
        else {
          const isProvider = selectedProviders.has(player.uid), isRecipient = recipients.has(player.uid);
          if (selectedBuff && !isProvider && !isRecipient) slot.classList.add('highlight-dim');
          if (isProvider) slot.classList.add('highlight-provider');
          if (isRecipient) slot.classList.add('highlight-recipient');
          if (editingPlayer === player.uid) {
            const editor = document.createElement('div'); editor.className = 'player-name-editor';
            const image = document.createElement('img'); image.className = 'player-mark'; image.src = player.icon; image.alt = '';
            const input = document.createElement('input'); input.className = 'player-name-input'; input.value = player.customName || ''; input.placeholder = player.name; input.maxLength = 40; input.setAttribute('aria-label', `Character name for ${player.name}`);
            const saveName = document.createElement('button'); saveName.className = 'name-action'; saveName.textContent = 'Save'; saveName.onclick = () => setPlayerName(player.uid, input.value);
            const cancelName = document.createElement('button'); cancelName.className = 'name-action'; cancelName.textContent = 'Cancel'; cancelName.onclick = () => { editingPlayer = null; render(); };
            input.onkeydown = event => {
              if (event.key === 'Enter') { event.preventDefault(); setPlayerName(player.uid, input.value); }
              if (event.key === 'Escape') { event.preventDefault(); editingPlayer = null; render(); }
            };
            editor.append(image, input, saveName, cancelName); slot.append(editor); queueMicrotask(() => { input.focus(); input.select(); });
          } else {
            const playerButton = document.createElement('button'); playerButton.className = `player-card${selectedPlayer === player.uid ? ' selected' : ''}`; playerButton.draggable = true; playerButton.style.setProperty('--class', player.color);
            const image = document.createElement('img'); image.className = 'player-mark'; image.src = player.icon; image.alt = '';
            const info = document.createElement('span'); info.className = 'player-info';
            const name = document.createElement('b'); name.textContent = playerLabel(player);
            const meta = document.createElement('small'); meta.textContent = `${player.className} · ${roleLabel(player)}`;
            info.append(name, meta); playerButton.append(image, info);
            playerButton.onclick = () => { selectedPlayer = player.uid; selectedBuff = null; detailMode = 'player'; render(); };
            playerButton.ondragstart = event => { dragPayload = { type: 'player', uid: player.uid }; event.dataTransfer.effectAllowed = 'move'; };
            const rename = document.createElement('button'); rename.className = 'rename-player'; rename.title = `Rename ${playerLabel(player)}`; rename.setAttribute('aria-label', rename.title); rename.textContent = '✎';
            rename.onclick = event => { event.stopPropagation(); editingPlayer = player.uid; render(); };
            const campButton = document.createElement('button'); campButton.className = 'camp-player';
            const selectedCamp = data.campBuffs.find(camp => camp.id === player.campBuffs?.[0]);
            campButton.title = `Camp buff for ${playerLabel(player)}${selectedCamp ? `: ${selectedCamp.name}` : ''}`; campButton.setAttribute('aria-label', campButton.title);
            const campArtwork = selectedCamp ? `<img class="camp-player-effect" src="${data.buffs[selectedCamp.covers[0]].icon}" alt="">` : '';
            campButton.innerHTML = `<span class="camp-player-icon" aria-hidden="true">♨</span>${campArtwork}<span class="camp-player-copy"><small>CAMP BUFF</small><b>${selectedCamp?.name || 'Choose'}</b></span>`;
            campButton.onclick = event => { event.stopPropagation(); editingCampPlayer = player.uid; renderCampDialog(); $('#camp-buff-dialog').showModal(); };
            const remove = document.createElement('button'); remove.className = 'remove-player'; remove.title = `Remove ${playerLabel(player)}`; remove.setAttribute('aria-label', remove.title); remove.textContent = '×';
            remove.onclick = event => { event.stopPropagation(); groups[groupIndex][slotIndex] = null; if (selectedPlayer === player.uid) { selectedPlayer = null; detailMode = 'overview'; } if (editingPlayer === player.uid) editingPlayer = null; save(); render(); };
            slot.append(playerButton, ...(raidSize === 5 ? [campButton] : []), rename, remove);
          }
        }
        card.append(slot);
      });
      const buffRoot = document.createElement('div'); buffRoot.className = 'group-buffs';
      const coverage = analysis.groupCoverage[groupIndex];
      const optionalEffects = analysis.groupOptionalEffects[groupIndex] || [];
      if (!coverage.length && !optionalEffects.length && !analysis.selectedCampBuffs.length && !analysis.groupGaps[groupIndex].length) buffRoot.innerHTML = '<span class="empty-coverage">No buffs provided</span>';
      for (const item of coverage) {
        const buff = data.buffs[item.buffId];
        const activeRecipients = item.recipients.filter(player => analysis.playerCoverage.get(player.uid).some(effect => effect.buffId === item.buffId));
        if (!activeRecipients.length) continue;
        const conflict = analysis.conflicts[groupIndex].some(entry => entry.buffIds.includes(item.buffId));
        const button = document.createElement('button'); button.className = `buff-chip${selectedBuff === item.buffId ? ' selected' : ''}${conflict ? ' conflict' : ''}`;
        button.title = `${buff.name}: ${activeRecipients.length} of ${occupied} players${conflict ? ' · choice needed' : ''}`;
        button.innerHTML = `<img class="effect-icon" src="${buff.icon}" alt=""><span>${activeRecipients.length}/${occupied}</span>`;
        button.onclick = () => { selectedBuff = selectedBuff === item.buffId ? null : item.buffId; detailMode = 'overview'; render(); };
        buffRoot.append(button);
      }
      for (const effect of optionalEffects) {
        const chip = document.createElement('span'); chip.className = 'buff-chip optional-effect';
        const plural = effect.capacity === 1 ? '' : 's';
        chip.title = `${effect.capacity} Paladin${plural} in this group can run ${effect.capacity === 1 ? 'one aura' : `up to ${effect.capacity} different auras`}: ${effect.options.join(', ')}. These are optional and are not treated as missing requirements.`;
        chip.innerHTML = `<img class="effect-icon" src="${effect.providers[0].icon}" alt=""><span>${effect.capacity} aura${plural}</span>`;
        buffRoot.append(chip);
      }
      for (const camp of analysis.selectedCampBuffs) {
        const chip = document.createElement('span'); chip.className = 'buff-chip camp-active';
        const campProviders = group.filter(Boolean).filter(player => analysis.playerCampBuffs.get(player.uid).some(item => item.id === camp.id));
        if (!campProviders.length) continue;
        chip.title = `${camp.name} (${camp.profession}) provided party-wide by ${campProviders.map(playerLabel).join(', ')} as a weaker, non-stacking substitute.`;
        chip.innerHTML = `<img class="effect-icon" src="${data.buffs[camp.covers[0]].icon}" alt=""><span>${camp.name} · ${campProviders.map(playerLabel).join(', ')}</span>`;
        buffRoot.append(chip);
      }
      for (const gap of analysis.groupGaps[groupIndex]) {
        const buff = data.buffs[gap.iconEffect || gap.effects[0]];
        const button = document.createElement('button'); button.className = 'buff-chip inactive';
        const recipientNames = gap.recipients.map(playerLabel).join(', ');
        const gapLabel = gap.showOptions ? gap.optionNames.join(' or ') : buff.name;
        button.title = `${gapLabel} is useful to ${recipientNames}, but this group has no provider.${gap.elsewhere.length ? ' A provider exists in another group.' : ''}`;
        button.innerHTML = `<img class="effect-icon" src="${buff.icon}" alt=""><span>Missing ${gapLabel}</span>`;
        button.onclick = () => { selectedBuff = gap.iconEffect || gap.effects[0]; detailMode = 'overview'; render(); };
        buffRoot.append(button);
      }
      card.append(buffRoot); root.append(card);
    });
  }
  function coverageRow(buffId, analysis, options = {}) {
    const buff = data.buffs[buffId], providerList = analysis.providers[buffId] || [];
    const camp = analysis.campCoverageSummary[buffId];
    const preferredCamp = camp.preferredComplete && camp.camps.find(item => item.preferCamp);
    const campFallback = !providerList.length && camp.complete ? camp.camps[0] : null;
    const covered = providerList.length || camp.complete;
    const variant = providerVariant(buff, options.provider);
    const button = document.createElement('button');
    const conflicted = analysis.conflictIds.has(buffId);
    button.className = `coverage-row ${buff.status !== 'confirmed' ? 'provisional' : ''}${!covered ? ' missing' : ''}${preferredCamp || campFallback ? ' camp-covered' : ''}${conflicted ? ' conflict' : ''}${selectedBuff === buffId ? ' selected' : ''}`;
    const defaultState = preferredCamp
      ? `Replaces ${buff.name} · party-wide`
      : (providerList.length
        ? `${providerList.length} provider${providerList.length === 1 ? '' : 's'}${conflicted ? ' · choice needed' : ''}`
        : (campFallback
          ? `Weaker ${buff.name} substitute · party-wide`
          : (camp.recipients.length ? `Camp assigned to ${camp.recipients.length}/${camp.eligibleRecipients.length} · still needed` : 'Missing')));
    const state = preferredCamp || campFallback ? defaultState : (options.state || defaultState);
    const marker = !covered ? (camp.recipients.length ? '⚠' : '×') : (preferredCamp || campFallback ? '≈' : (conflicted ? '⚠' : '✓'));
    const icon = document.createElement('span'); icon.className = 'coverage-icon';
    const image = document.createElement('img'); image.src = variant?.icon || buff.icon; image.alt = ''; icon.append(image);
    const copy = document.createElement('span'); copy.className = 'coverage-copy';
    const name = document.createElement('b'); name.textContent = preferredCamp?.name || campFallback?.name || variant?.name || buff.name;
    const detail = document.createElement('small'); detail.textContent = state; copy.append(name, detail);
    const confidence = document.createElement('span'); confidence.className = 'confidence'; confidence.title = state; confidence.textContent = marker;
    button.append(icon, copy, confidence);
    button.onclick = () => { selectedBuff = selectedBuff === buffId ? null : buffId; render(); };
    return button;
  }
  function bossCoverageRow(item, analysis) {
    const conflicted = item.effects.some(id => analysis.conflictIds.has(id));
    const button = document.createElement('button');
    button.className = `coverage-row${!item.providers.length ? ' missing' : ''}${conflicted ? ' conflict' : ''}${selectedBuff && item.effects.includes(selectedBuff) ? ' selected' : ''}`;
    const state = item.providers.length ? `${item.providers.length} provider${item.providers.length === 1 ? '' : 's'}${conflicted ? ' · choice needed' : ''}` : 'Missing';
    const marker = !item.providers.length ? '×' : (conflicted ? '⚠' : '✓');
    button.innerHTML = `<span class="coverage-icon"><img src="${item.displayIcon}" alt=""></span><span class="coverage-copy"><b>${item.displayName}</b><small>${state}</small></span><span class="confidence" title="${state}">${marker}</span>`;
    button.onclick = () => { const id = item.displayEffect; selectedBuff = selectedBuff === id ? null : id; render(); };
    return button;
  }
  function overview(analysis) {
    const root = document.createElement('div'); root.className = 'coverage-body'; root.innerHTML = `<h2>Buffs & debuffs</h2><p>${analysis.players.length} of ${raidSize} roster spots filled</p>`;
    const raid = document.createElement('section'); raid.className = 'coverage-section'; raid.innerHTML = '<h3>BUFFS</h3>';
    for (const id of data.recommended.raid) raid.append(coverageRow(id, analysis));
    root.append(raid);
    const boss = document.createElement('section'); boss.className = 'coverage-section'; boss.innerHTML = '<h3>DEBUFFS</h3>';
    for (const item of analysis.bossChecklist) boss.append(bossCoverageRow(item, analysis));
    root.append(boss);
    const party = document.createElement('section'); party.className = 'coverage-section'; party.innerHTML = '<h3>GROUPS</h3>';
    groups.forEach((group, index) => {
      const effects = analysis.groupCoverage[index].length;
      const optional = analysis.groupOptionalEffects[index] || [];
      const conflicts = analysis.conflicts[index].length;
      const gaps = analysis.groupGaps[index].length;
      const optionalLabel = optional.map(effect => `${effect.capacity} aura${effect.capacity === 1 ? '' : 's'} available`).join(' · ');
      const campLabel = raidSize === 5 && analysis.selectedCampBuffs.length ? `${analysis.selectedCampBuffs.length} camp buff${analysis.selectedCampBuffs.length === 1 ? '' : 's'}` : '';
      const row = document.createElement('div'); row.className = 'coverage-row'; row.innerHTML = `<span class="coverage-icon">${index + 1}</span><span class="coverage-copy"><b>Group ${index + 1}</b><small>${effects} party effect${effects === 1 ? '' : 's'} · ${gaps} relevant gap${gaps === 1 ? '' : 's'}${optionalLabel ? ` · ${optionalLabel}` : ''}${campLabel ? ` · ${campLabel}` : ''} · ${group.filter(Boolean).length} of 5 players</small></span><span class="confidence">${conflicts || gaps ? '⚠' : '✓'}</span>`;
      party.append(row);
    });
    root.append(party);
    if (selectedBuff) {
      const buff = data.buffs[selectedBuff], sources = analysis.providers[selectedBuff] || [];
      const camp = analysis.campCoverageSummary[selectedBuff];
      const note = document.createElement('p'); note.className = 'note';
      const heading = document.createElement('b'); heading.textContent = buff.name;
      const campText = camp.camps.length ? `Camp: ${camp.camps.map(item => item.name).join(', ')} covers ${camp.recipients.length}/${camp.eligibleRecipients.length} eligible players party-wide` : '';
      const sourceText = sources.length ? `${detailedProviders(buff, sources)}${campText ? ` · ${campText}` : ''}` : (campText || 'None');
      note.append(heading, document.createElement('br'), document.createTextNode(`Providers: ${sourceText}`)); root.append(note);
    }
    return root;
  }
  function playerDetail(analysis) {
    const player = analysis.players.find(item => item.uid === selectedPlayer);
    if (!player) { detailMode = 'overview'; return overview(analysis); }
    const position = locate(player.uid), root = document.createElement('div'); root.className = 'coverage-body';
    const heading = document.createElement('h2'); heading.textContent = playerLabel(player);
    const summary = document.createElement('p'); summary.textContent = `${player.className} · ${roleLabel(player)} · Group ${position.g + 1}, slot ${position.s + 1}`;
    root.append(heading, summary);
    const applied = analysis.playerCoverage.get(player.uid) || [];
    for (const [scope, title] of [['party','PARTY EFFECTS RECEIVED'],['raid','RAID BUFFS RECEIVED']]) {
      const section = document.createElement('section'); section.className = 'coverage-section'; section.innerHTML = `<h3>${title}</h3>`;
      const items = applied.filter(item => data.buffs[item.buffId].scope === scope);
      if (!items.length) section.innerHTML += '<p class="empty-coverage">None</p>';
      for (const item of items) section.append(coverageRow(item.buffId, analysis, { state: `${item.conflicted || item.assignmentConflicted ? 'Choice needed · ' : ''}Provided by ${providersLabel(item.providers)}` }));
      root.append(section);
    }
    const assignedCamps = analysis.playerCampBuffs.get(player.uid) || [];
    if (raidSize === 5 && assignedCamps.length) {
      const campSection = document.createElement('section'); campSection.className = 'coverage-section'; campSection.innerHTML = '<h3>CAMP BUFF PROVIDED</h3>';
      for (const camp of assignedCamps) {
        const row = document.createElement('div'); row.className = 'coverage-row camp-covered';
        row.innerHTML = `<span class="coverage-icon"><img src="${data.buffs[camp.covers[0]].icon}" alt=""></span><span class="coverage-copy"><b>${camp.name}</b><small>${camp.profession} · weaker substitute</small></span><span class="confidence" title="Applied to the full party">≈</span>`;
        campSection.append(row);
      }
      root.append(campSection);
    }
    const provides = document.createElement('section'); provides.className = 'coverage-section'; provides.innerHTML = '<h3>EFFECTS PROVIDED</h3>';
    if (!player.provides.length) provides.innerHTML += '<p class="empty-coverage">None</p>';
    for (const id of player.provides) {
      provides.append(coverageRow(id, analysis, { provider: player, state: scopeLabel(data.buffs[id].scope) }));
    }
    root.append(provides); return root;
  }
  function renderCoverage(analysis) {
    $('#overview-tab').classList.toggle('active', detailMode === 'overview'); $('#player-tab').classList.toggle('active', detailMode === 'player');
    $('#player-tab').disabled = !selectedPlayer;
    const holder = $('#coverage-detail'); holder.innerHTML = ''; holder.append(detailMode === 'player' ? playerDetail(analysis) : overview(analysis));
  }
  function render() {
    const campAssignments = Object.fromEntries(groups.flat().filter(Boolean).map(player => [player.uid, raidSize === 5 ? (player.campBuffs || []) : []]));
    const analysis = engine.analyze(groups, data, { campAssignments });
    $('#raid-size').value = raidSize;
    $('#filled-count').textContent = analysis.players.length;
    $('#player-noun').textContent = analysis.players.length === 1 ? 'player' : 'players';
    $('#groups').classList.toggle('single-group', raidSize === 5);
    renderPalette(); renderGroups(analysis); renderCoverage(analysis);
  }
  $('#spec-search').oninput = renderPalette;
  $('#raid-size').onchange = event => {
    const nextSize = Number(event.target.value), next = blankGroups(nextSize);
    groups.flat().filter(Boolean).slice(0, nextSize).forEach((player, index) => next[Math.floor(index / 5)][index % 5] = player);
    groups = next; raidSize = nextSize; if (raidSize !== 5) groups.flat().filter(Boolean).forEach(player => { player.campBuffs = []; }); editingPlayer = null; editingCampPlayer = null; if (selectedPlayer && !locate(selectedPlayer)) selectedPlayer = null; save(); render();
  };
  $('#clear').onclick = () => { groups = blankGroups(raidSize); selectedPlayer = null; selectedBuff = null; editingPlayer = null; editingCampPlayer = null; detailMode = 'overview'; save(); render(); };
  $('#share-raid').onclick = () => {
    const code = raidState.encode(shareSnapshot(), data);
    $('#raid-link').value = `${location.href.split('#')[0]}#${code}`;
    const local = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    $('#raid-share-note').textContent = local ? 'This local preview link works while the preview is running.' : 'Anyone with this link can open this raid composition.';
    $('#raid-share-status').textContent = '';
    $('#raid-share-dialog').showModal();
  };
  $('#close-camp-buffs').onclick = () => { editingCampPlayer = null; $('#camp-buff-dialog').close(); };
  $('#close-raid-share').onclick = () => $('#raid-share-dialog').close();
  $('#copy-raid-link').onclick = async () => {
    try { await navigator.clipboard.writeText($('#raid-link').value); $('#raid-share-status').textContent = 'Raid link copied.'; }
    catch (_) { $('#raid-link').focus(); $('#raid-link').select(); $('#raid-share-status').textContent = 'Press Command+C (Mac) or Ctrl+C to copy the selected link.'; }
  };
  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith(`#${raidState.prefix}`)) return;
    try {
      const shared = raidState.decode(location.hash.slice(1), data);
      hydrate(shared); selectedPlayer = null; selectedBuff = null; editingPlayer = null; detailMode = 'overview'; render(); setStatus('Shared raid loaded.');
    } catch (_) { setStatus('Could not load shared raid.'); }
  });
  $('#overview-tab').onclick = () => { detailMode = 'overview'; render(); };
  $('#player-tab').onclick = () => { if (selectedPlayer) { detailMode = 'player'; selectedBuff = null; render(); } };
  render(); setStatus(initialStatus);
})();
