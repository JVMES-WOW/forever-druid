(() => {
  'use strict';
  const sim = window.FOREVER_FERAL_SIM;
  const optimizer = window.FOREVER_FERAL_OPTIMIZER;
  const tradeoffs = window.FOREVER_FERAL_TRADEOFFS;
  const $ = selector => document.querySelector(selector);
  const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const fixed = value => value == null ? '—' : Number(value).toFixed(2);
  const castNames = new Set(Object.values(sim.LABELS));
  const ownActionNames = new Set([...castNames, 'Major Mana Potion', 'Thistle Tea']);
  const autoNames = new Set(['Autoattack', 'Windfury attack']);
  let logFight = null;
  let lastResult = null;
  let running = false, optimizing = false, optimizationJob = null, optimizationTicket = 0;
  let optimizationResult = null, optimizationSnapshot = null, optimizationApplied = false;
  let optimizationObjectiveSnapshot = null;
  let lastOptimizationSeed = null;
  let exploring = false, tradeJob = null, tradeTicket = 0, tradeResult = null, tradeSnapshot = null;
  let tradeSelected = null, tradeValidation = null, tradeApplied = false, lastTradeSeed = null;

  function config() {
    const values = Object.fromEntries(new FormData($('#config')).entries());
    values.shiftingThreshold = $('#shiftingThreshold').value; // Preserve the disabled manual setting.
    $('#config').querySelectorAll('input[type="checkbox"]').forEach(input => { if (input.name) values[input.name] = input.checked; });
    return sim.normalize(values);
  }
  function freshSeed(...previous) {
    let seed;
    if (window.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      seed = values[0];
    } else {
      seed = Math.floor(Math.random() * 4294967296) >>> 0;
    }
    // Even a random collision must not repeat the previous run's seed.
    while (previous.includes(seed)) seed = (seed + 1) >>> 0;
    return seed;
  }
  function bars(target, rows) {
    const max = Math.max(1, ...rows.map(row => row.value));
    $(target).innerHTML = rows.map(row => `<div class="bar-row"><span>${row.label}</span><span class="bar-track"><i style="width:${Math.max(0, row.value / max * 100)}%"></i></span><b>${number(row.value)}</b></div>`).join('');
  }
  function signedNumber(value) {
    // Suppress signed zero after display rounding, including floating-point
    // cancellation in otherwise balanced net flow.
    const magnitude = Math.round(Math.abs(value) * 10) / 10;
    return magnitude ? `${value < 0 ? '−' : '+'}${number(magnitude)}` : '0';
  }
  function manaBars(rows) {
    // Both halves share one scale: equal amounts have equal lengths, with
    // zero fixed at the center even when only one direction has any flow.
    const max = Math.max(...rows.map(row => Math.abs(row.value))) || 1;
    const axis = '<div class="mana-flow-axis" aria-hidden="true"><span></span><span class="mana-flow-directions"><span>−</span><span>0</span><span>+</span></span><span></span></div>';
    $('#mana-chart').innerHTML = axis + rows.map(row => {
      const direction = row.value < 0 ? 'out' : row.value > 0 ? 'in' : 'zero';
      const width = Math.abs(row.value) / max * 50;
      const edge = row.value < 0 ? 'right' : 'left';
      return `<div class="mana-flow-row"><span class="mana-flow-label">${row.label}</span><span class="mana-flow-track" aria-hidden="true"><i class="mana-flow-${direction}" style="${edge}:50%;width:${width}%"></i></span><b>${signedNumber(row.value)}</b></div>`;
    }).join('');
  }
  function durationRange(result) {
    const { min, max } = result.durationStats;
    return min === max ? number(min) : `${number(min)}–${number(max)}`;
  }
  function render(result) {
    lastResult = result;
    const perFive = $('#mana-per-five').checked;
    const manaUnit = perFive ? '5s' : 'min';
    const manaRate = total => total * (perFive ? 5 : 60) / result.durationStats.mean;
    $('#duration-summary').textContent = `Actual fight lengths: ${durationRange(result)}s · mean ${number(result.durationStats.mean)}s. CPM and mana rates use total casts or mana divided by total actual combat time.`;
    $('#mana-flow-title').textContent = `Mana flow / ${perFive ? '5 seconds' : 'minute'}`;
    $('#mana-rate-label').textContent = perFive ? 'MP5' : 'MPM';
    const manaTotal = Object.values(result.manaGained).reduce((sum, item) => sum + item.mean, 0);
    const cards = [
      ['Attack CPM', fixed(['rake', 'shred', 'rip', 'bite'].reduce((sum, id) => sum + result.abilityStats[id].cpm, 0)), 'Rake + Shred + Rip + Bite'],
      ['Finisher CPM', fixed(result.finisherCasts.cpm), `Rip ${fixed(result.abilityStats.rip.cpm)} + Bite ${fixed(result.abilityStats.bite.cpm)}`],
      ['Time to OOM', result.oom.count ? `${fixed(result.oom.mean)}s` : 'No OOM', result.oom.count ? `Mean among ${result.oom.count.toLocaleString()} OOM fights` : `Within ${durationRange(result)}s fights`],
      [`Mana spent / ${manaUnit}`, number(manaRate(result.manaSpent.mean)), `${number(result.manaSpent.mean)} per fight`],
      [`Mana gained / ${manaUnit}`, number(manaRate(manaTotal)), `${number(result.endingMana.mean)} ending mana`],
      ['OOM rate', `${fixed(result.oom.percent)}%`, result.oom.count ? `${fixed(result.oom.mean)}s mean` : 'No starved iterations'],
      ['Energy wasted', number(result.energy.waste.mean), `${number(result.energy.natural.mean + result.energy.shifting.mean + result.energy.tea.mean)} raw generated`],
      ['Blood Frenzy', number(result.bloodFrenzy.procs.mean), `${number(result.bloodFrenzy.attempts.mean)} attempts / fight`],
      ['Judgment procs', number(result.jow.procs.mean), `${number(result.jow.attempts.mean)} attempts / fight`],
      ['Potions', number(result.potion.uses.mean), `${number(result.potion.gained.mean)} effective mana / fight`],
      ['Thistle Tea', number(result.tea.uses.mean), `${number(result.tea.gained.mean)} useful energy / fight`],
      ['Clearcasting procs (rolled)', number(result.omen.procs.mean), `${result.omen.startingProcs.mean ? `${number(result.omen.startingProcs.mean)} starting buff · ` : ''}${number(result.omen.freeCasts.mean)} free-base-cost casts · ${number(result.omen.energySaved.mean)} energy saved / fight`],
      ['Windfury procs', number(result.windfury.procs.mean), `${number(result.windfury.extraAttacks.mean)} attacks · ${number(result.windfury.landed.mean)} landed / fight`],
      ['Crits created / Berserk', fixed(result.berserkCrits.perUse.created), `Rake ${fixed(result.berserkCrits.perUse.rake)} · Shred ${fixed(result.berserkCrits.perUse.shred)} per use`]
    ];
    $('#summary').innerHTML = cards.map(card => `<article class="summary-card"><span>${card[0]}</span><b>${card[1]}</b><small>${card[2]}</small></article>`).join('');
    $('#total-cpm').textContent = `Total CPM: ${fixed(result.totalCasts.cpm)}`;
    bars('#casts-chart', sim.ABILITIES.map(id => ({ label: sim.LABELS[id], value: result.abilityStats[id].cpm })));
    const manaRows = [['Spirit', 'spirit'], ['Blessing', 'blessing'], ['Mana Spring', 'spring'], ['Judgment', 'jow'], ['Potion', 'potion']];
    manaBars([...manaRows.map(([label, id]) => ({ label, value: manaRate(result.manaGained[id].mean) })), { label: 'Spent', value: -manaRate(result.manaSpent.mean) }]);
    $('#mana-net-flow').textContent = `Net flow: ${signedNumber(manaRate(manaTotal - result.manaSpent.mean))} mana / ${perFive ? '5 seconds' : 'minute'}`;
    $('#ability-table').innerHTML = sim.ABILITIES.map(id => { const a = result.abilityStats[id]; return `<tr><td>${sim.LABELS[id]}</td><td>${fixed(a.mean)}</td><td>${fixed(a.cpm)}</td><td>${fixed(a.sd)}</td><td>${fixed(a.median)}</td><td>${fixed(a.p5)}</td><td>${fixed(a.p95)}</td><td>${fixed(result.berserkCasts[id].mean)}</td></tr>`; }).join('');
    $('#berserk-crits-table').innerHTML = [['Rake', 'rake'], ['Shred', 'shred'], ['Total', 'created']].map(([label, key]) => `<tr><td>${label}</td><td>${fixed(result.berserkCrits[key].mean)}</td><td>${fixed(result.berserkCrits.perUse[key])}</td></tr>`).join('');
    $('#berserk-crits-sample').textContent = `${number(result.berserkCrits.uses)} Berserk uses across ${number(result.fights)} fights`;
    const rawCP = result.cp.normal.mean + result.cp.bloodFrenzy.mean + result.cp.waste.mean;
    const cappedCPPercent = rawCP ? result.cp.atCapWaste.mean / rawCP * 100 : 0;
    $('#cp-cap-table').innerHTML = [['Rake', 'rakeAtCapCasts', 'rakeAtCapWaste'], ['Shred', 'shredAtCapCasts', 'shredAtCapWaste'], ['Total', 'atCapCasts', 'atCapWaste']]
      .map(([label, casts, waste]) => `<tr><td>${label}</td><td>${fixed(result.cp[casts].mean)}</td><td>${fixed(result.cp[waste].mean)}</td></tr>`).join('');
    $('#cp-cap-summary').textContent = `${fixed(cappedCPPercent)}% of all raw CP is lost from casts starting at 5 CP. Another ${fixed(result.cp.waste.mean - result.cp.atCapWaste.mean)} CP / fight overflows from casts starting below 5 CP.`;
    $('#mana-table').innerHTML = [...manaRows.map(([label, id]) => `<tr><td>${label}</td><td>${fixed(result.manaGained[id].mean)}</td><td>${fixed(manaRate(result.manaGained[id].mean))}</td></tr>`), `<tr><td>Potion rolled</td><td>${fixed(result.potion.rolled.mean)}</td><td>${fixed(manaRate(result.potion.rolled.mean))}</td></tr>`, `<tr><td>Potion wasted</td><td>${fixed(result.potion.waste.mean)}</td><td>${fixed(manaRate(result.potion.waste.mean))}</td></tr>`, `<tr><td>All mana wasted</td><td>${fixed(result.manaWaste.mean)}</td><td>${fixed(manaRate(result.manaWaste.mean))}</td></tr>`, `<tr><td><b>Spent</b></td><td>${fixed(result.manaSpent.mean)}</td><td>${fixed(manaRate(result.manaSpent.mean))}</td></tr>`].join('');
    const resourceRows = [
      ['Natural energy generated', result.energy.natural.mean], ['Shifting Power energy (raw)', result.energy.shifting.mean], ['Shifting energy (useful)', result.energy.shifting.mean - result.energy.shiftingWaste.mean], ['Shifting energy wasted', result.energy.shiftingWaste.mean],
      ['Thistle Tea energy (raw)', result.energy.tea.mean], ['Tea energy (useful)', result.tea.gained.mean], ['Tea energy wasted', result.energy.teaWaste.mean], ['All energy wasted', result.energy.waste.mean],
      ['Starting Clearcasting buffs', result.omen.startingProcs.mean], ['Clearcasting eligible rolls', result.omen.attempts.mean], ['Clearcasting base cost waived', result.omen.costWaived.mean], ['Clearcasting net energy saved', result.omen.energySaved.mean],
      ['Clearcasting expired unused', result.omen.expired.mean], ['Clearcasting refreshed while active', result.omen.refreshed.mean], ['Clearcasting remaining at end', result.omen.remaining.mean],
      ['Windfury eligible rolls (ICD ready)', result.windfury.attempts.mean], ['Windfury attacks pending at end', result.windfury.pending.mean],
      ['Normal CP generated', result.cp.normal.mean], ['Blood Frenzy CP', result.cp.bloodFrenzy.mean], ['CP wasted', result.cp.waste.mean],
      ['CP consumed by Rip', result.cp.ripConsumed.mean], ['CP consumed by Bite', result.cp.biteConsumed.mean]
    ];
    $('#resource-table').innerHTML = resourceRows.map(row => `<tr><td>${row[0]}</td><td>${fixed(row[1])}</td></tr>`).join('');
    $('#uptime').innerHTML = [['Rake', 'rake'], ['Rip', 'rip'], ['Berserk', 'berserk'], ['Clearcasting', 'clearcasting']].map(([label, id]) => `<div><div class="uptime-head"><span>${label}</span><b>${fixed(result.uptime[id].mean)}%</b></div><div class="uptime-track"><i style="width:${Math.min(100, result.uptime[id].mean)}%"></i></div></div>`).join('');
    renderOom(result);
  }
  function renderOom(result) {
    const shiftCost = number(sim.shiftingPowerCost(result.config));
    $('#oom-label').textContent = result.oom.count ? `${result.oom.count}/${result.fights} fights · ${fixed(result.oom.percent)}%` : `0/${result.fights} fights`;
    $('#oom-detail').textContent = result.oom.count
      ? `Mean ${fixed(result.oom.mean)}s · Median ${fixed(result.oom.median)}s among fights that OOM. OOM is the first time Shifting Power is due but ${shiftCost} mana is unavailable.`
      : `${result.durationStats.min === result.durationStats.max ? `No OOM within ${durationRange(result)} seconds.` : `No OOM observed across fights lasting ${durationRange(result)} seconds.`} Longer-term sustainability has not been measured. OOM is the first time Shifting Power is due but ${shiftCost} mana is unavailable.`;
    if (result.oom.count && result.config.durationVariance) $('#oom-detail').textContent += ` Actual fight lengths: ${durationRange(result)}s; fights without OOM were observed only until their own end times.`;
    if (!result.oom.times.length) { $('#oom-chart').innerHTML = '<span class="empty">No iterations became mana-starved before the fight ended.</span>'; return; }
    const bins = 30, counts = Array(bins).fill(0), width = result.durationStats.max / bins;
    result.oom.times.forEach(time => counts[Math.min(bins - 1, Math.floor(time / width))]++);
    const max = Math.max(...counts);
    $('#oom-chart').innerHTML = counts.map((count, i) => `<i style="height:${count / max * 100}%" title="${fixed(i * width)}–${fixed((i + 1) * width)}s: ${count}"></i>`).join('');
  }
  function renderLog(fight, baseSeed) {
    logFight = fight;
    $('#debug-seed').textContent = `base seed ${baseSeed} · iteration ${fight.iteration} · derived seed ${fight.seed} · duration ${number(fight.duration)}s`;
    $('#log-oom').textContent = fight.oomTime === null ? `This fight: no OOM within ${number(fight.duration)}s` : `This fight: OOM at ${fixed(fight.oomTime)}s`;
    updateLog();
  }
  function updateLog() {
    const castsOnly = $('#log-view').value === 'casts';
    $('#log-autoattacks').disabled = castsOnly;
    $('#log-procs').disabled = castsOnly;
    if (!logFight) return;
    const showAutos = $('#log-autoattacks').checked, showProcs = $('#log-procs').checked;
    const events = logFight.log.filter(event => {
      if (castsOnly) return castNames.has(event.action);
      // Windfury attacks belong to both filters. Passive ticks and aura
      // lifecycle events are also hidden to leave a clean own-actions view.
      return (showAutos || !autoNames.has(event.action)) &&
        (showProcs || ownActionNames.has(event.action) || event.action === 'Autoattack');
    });
    $('#log-count').textContent = `${events.length.toLocaleString()} of ${logFight.log.length.toLocaleString()} events shown · Filters only change this view.`;
    $('#combat-log').innerHTML = events.map(event => `<tr><td>${event.time.toFixed(2)}</td><td>${event.action}</td><td>${event.detail || '—'}</td><td>${fixed(event.before.energy)} → ${fixed(event.after.energy)}</td><td>${fixed(event.before.mana)} → ${fixed(event.after.mana)}</td><td>${event.before.cp} → ${event.after.cp}</td></tr>`).join('') || '<tr><td colspan="6">No events match these filters.</td></tr>';
  }
  function run(seedOverride) {
    if (running || optimizing || exploring) return;
    running = true; $('#optimize').disabled = true;
    updateTradeButtons();
    $('#run').disabled = true; $('#status').textContent = 'Running seeded combat iterations…';
    setTimeout(() => {
      try {
        const c = config();
        if (Number.isInteger(seedOverride)) c.seed = seedOverride;
        else if ($('#fresh-seed').checked) c.seed = freshSeed(c.seed);
        $('#seed').value = String(c.seed);
        const result = sim.runSimulation(c);
        render(result);
        // Keep an already-open replay aligned with the new run and seed.
        if (logFight) renderLog(sim.replay(c, c.replayIteration), c.seed);
        const lengths = result.config.durationVariance
          ? `${number(result.config.duration)} ±${number(result.config.durationVariance)}s requested · ${durationRange(result)}s actual · mean ${number(result.durationStats.mean)}s`
          : `${number(result.config.duration)} seconds`;
        $('#status').textContent = `Complete: ${result.fights.toLocaleString()} fights × ${lengths} · seed ${c.seed}.`;
      }
      catch (error) { $('#status').textContent = `Could not run: ${error.message}`; }
      finally { running = false; $('#run').disabled = false; $('#optimize').disabled = false; updateTradeButtons(); }
    }, 20);
  }
  function replay() {
    if (optimizing || exploring) return;
    try { const c = config(), fight = sim.replay(c, c.replayIteration); renderLog(fight, c.seed); $('#status').textContent = `Replayed iteration ${fight.iteration} · duration ${number(fight.duration)}s · base seed ${c.seed} · derived seed ${fight.seed}.`; $('.debug-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch (error) { $('#status').textContent = `Could not replay: ${error.message}`; }
  }
  function updatePotionControls() {
    $('#potion-policy').disabled = !$('#use-potions').checked;
  }
  function updateSeedControls() {
    $('#seed').readOnly = $('#fresh-seed').checked;
  }
  function updateShiftingControls() {
    const automatic = $('#shifting-mode').value === 'automatic';
    $('#shiftingThreshold').disabled = automatic;
    $('#opt-shiftingThreshold-on').disabled = automatic;
    $('#opt-shiftingThreshold-values').disabled = automatic;
  }
  function optimizerBusy(busy) {
    optimizing = busy;
    $('#optimize').disabled = busy || running; $('#opt-stop').disabled = !busy;
    $('#run').disabled = busy || running; $('#replay').disabled = busy;
    $('#opt-apply').disabled = busy || optimizationApplied || !optimizationResult || optimizationResult.best.id === 0 || optimizerObjectiveStale();
    updateTradeButtons();
  }
  function renderOptimization(result) {
    const gain = value => `${value > 0 ? '+' : ''}${fixed(value)}`;
    $('#optimizer-status').textContent = `Complete · ${result.candidatesTested} of ${number(result.space)} combinations tested${result.exhaustive ? ' (entire selected grid)' : ' (sampled grid)'} · ${number(result.completedFights)} fights · seed ${result.config.seed}.`;
    $('#optimizer-summary').textContent = `Best tested ${optimizer.objectiveLabel(result.options)}: ${fixed(result.best.score)} vs current ${fixed(result.baseline.score)} (${gain(result.best.scoreGain)}). Attack CPM ${fixed(result.best.cpm)} · Finisher CPM ${fixed(result.best.finisherCPM)} (Rip ${fixed(result.best.abilityCPM.rip)} + Bite ${fixed(result.best.abilityCPM.bite)}). Finalists retested on ${result.options.validationIterations} fresh fights each, iterations ${result.validationFirstIteration}–${result.validationLastIteration}.`;
    $('#optimizer-best-settings').textContent = Object.entries(optimizer.PARAMETERS).map(([key, parameter]) => key === 'shiftingThreshold' && result.config.shiftingMode === 'automatic'
      ? 'Shifting: automatic energy-loss comparison' : `${parameter.label}: ${number(result.config[key])} → ${number(result.best.params[key])}`).join(' · ');
    $('#optimizer-table').innerHTML = result.ranked.map(item => {
      const cells = [item.id === 0 ? 'Current settings' : item.id === result.best.id ? 'Best tested' : `Candidate ${item.id}`,
        fixed(item.score), gain(item.scoreGain), fixed(item.scoreSe), fixed(item.cpm), fixed(item.finisherCPM),
        fixed(item.abilityCPM.rip), fixed(item.abilityCPM.bite), `${fixed(item.ripUptime)}%`,
        result.config.shiftingMode === 'automatic' ? 'Auto' : number(item.params.shiftingThreshold),
        number(item.params.biteMaxEnergy), number(item.params.biteRipOutside), number(item.params.biteRipBerserk),
        number(item.params.ripMinCP), number(item.params.biteMinCP), `${fixed(item.rakeUptime)}%`, `${fixed(item.oomPercent)}%`];
      return `<tr>${cells.map(value => `<td>${value}</td>`).join('')}</tr>`;
    }).join('');
    if (result.best.id === 0) $('#optimizer-summary').textContent += ' Current settings performed best; nothing to apply.';
    if (optimizerObjectiveStale()) $('#optimizer-status').textContent += ' Optimization objective or weights changed. Optimize again before applying.';
    $('#optimizer-progress').max = result.completedFights; $('#optimizer-progress').value = result.completedFights;
  }
  function optimizeRotation() {
    if (running || optimizing || exploring) return;
    $('#optimizer-results').hidden = false;
    optimizationResult = null; optimizationSnapshot = null; optimizationObjectiveSnapshot = null; optimizationApplied = false;
    $('#optimizer-table').innerHTML = ''; $('#optimizer-summary').textContent = ''; $('#optimizer-best-settings').textContent = '';
    $('#optimizer-progress').max = 1; $('#optimizer-progress').value = 0;
    optimizerBusy(false);
    try {
      const base = config();
      const parameterValues = Object.fromEntries(Object.keys(optimizer.PARAMETERS)
        .filter(key => $(`#opt-${key}-on`).checked && (key !== 'shiftingThreshold' || base.shiftingMode === 'manual')).map(key => [key, $(`#opt-${key}-values`).value]));
      const objective = optimizerObjective();
      const options = optimizer.normalizeOptions({ preset: $('#opt-preset').value, parameterValues, ...objective });
      const searchConfig = { ...base, seed: $('#fresh-seed').checked ? freshSeed(base.seed, lastOptimizationSeed) : base.seed };
      lastOptimizationSeed = searchConfig.seed;
      optimizationSnapshot = base;
      optimizationObjectiveSnapshot = objective;
      optimizationJob = optimizer.optimize(searchConfig, options);
      const ticket = ++optimizationTicket;
      $('#optimizer-status').textContent = `Starting ${optimizer.objectiveLabel(options)} search · seed ${searchConfig.seed}. Current settings are unchanged.`;
      optimizerBusy(true);
      function pump() {
        if (ticket !== optimizationTicket || !optimizationJob) return;
        try {
          const start = Date.now();
          for (let batch = 0; batch < 8; batch++) {
            const next = optimizationJob.next();
            if (next.done) {
              optimizationResult = next.value; optimizationJob = null;
              renderOptimization(optimizationResult); optimizerBusy(false); return;
            }
            const progress = next.value;
            $('#optimizer-progress').max = progress.totalFights; $('#optimizer-progress').value = progress.completedFights;
            $('#optimizer-status').textContent = `${progress.phase} ${progress.candidateIndex}/${progress.candidateCount} · ${number(progress.completedFights)}/${number(progress.totalFights)} fights · seed ${progress.seed}.`;
            if (Date.now() - start >= 12) break;
          }
          setTimeout(pump, 0);
        } catch (error) {
          optimizationJob = null; optimizationResult = null; optimizerBusy(false);
          $('#optimizer-status').textContent = `Could not optimize: ${error.message}`;
        }
      }
      setTimeout(pump, 0);
    } catch (error) {
      $('#optimizer-status').textContent = `Could not optimize: ${error.message}`;
    }
  }
  function stopOptimization() {
    if (!optimizing) return;
    optimizationTicket++; optimizationJob?.return(); optimizationJob = null; optimizationResult = null;
    optimizerBusy(false);
    $('#optimizer-status').textContent = 'Optimization stopped. No settings or simulation results were changed.';
  }
  function applyOptimization() {
    if (!optimizationResult || optimizing || exploring || running || optimizationApplied || optimizationResult.best.id === 0) return;
    if (JSON.stringify(config()) !== JSON.stringify(optimizationSnapshot)) {
      $('#optimizer-status').textContent = 'Simulation settings changed since this search. Optimize again before applying its result.'; return;
    }
    if (optimizerObjectiveStale()) {
      $('#optimizer-status').textContent = 'Optimization objective or weights changed since this search. Optimize again before applying its result.'; return;
    }
    for (const key of Object.keys(optimizationResult.options.parameterValues)) $(`#${key}`).value = String(optimizationResult.best.params[key]);
    optimizationApplied = true; $('#opt-apply').disabled = true;
    $('#optimizer-status').textContent = `Best tested parameters applied. Running your full simulation with optimizer seed ${optimizationResult.config.seed}.`;
    // Reproduce this search seed once, without changing the user's fresh-seed
    // preference for subsequent ordinary Runs.
    run(optimizationResult.config.seed);
  }
  function optimizerObjective() {
    return optimizer.normalizeObjective({ objective: $('#opt-objective').value,
      ripWeight: $('#opt-rip-weight').value, biteWeight: $('#opt-bite-weight').value });
  }
  function optimizerObjectiveStale() {
    try { return Boolean(optimizationObjectiveSnapshot && JSON.stringify(optimizerObjective()) !== JSON.stringify(optimizationObjectiveSnapshot)); }
    catch (_) { return true; }
  }
  function updateObjectiveControls() {
    const weighted = $('#opt-objective').value === 'weightedFinishers';
    $('#opt-rip-weight').disabled = !weighted; $('#opt-bite-weight').disabled = !weighted;
    try {
      const objective = optimizerObjective();
      $('#opt-objective-note').textContent = `${optimizer.objectiveLabel(objective)}. ${objective.objective === 'attack'
        ? 'Rake + Shred + Rip + Bite casts all count equally.' : objective.objective === 'finishers'
          ? 'Rip + Bite casts count equally; builders do not contribute to the primary score.'
          : '2:1 values each Rip twice as highly as each Bite; 1:1 values them equally. Use 0:1 to optimize Bite CPM alone. This is a preference score, not DPS.'} All objectives count attempted casts, including avoidance.`;
    } catch (error) { $('#opt-objective-note').textContent = error.message; }
    if (optimizationResult && optimizerObjectiveStale()) $('#optimizer-status').textContent = 'Optimization objective or weights changed. Optimize again before applying its result.';
    $('#opt-apply').disabled = optimizing || exploring || running || optimizationApplied || !optimizationResult || optimizationResult.best.id === 0 || optimizerObjectiveStale();
  }
  function tradeStale() {
    try { return Boolean(tradeSnapshot && JSON.stringify(config()) !== JSON.stringify(tradeSnapshot)); }
    catch (_) { return true; } // Invalid edited inputs are never safe to apply against.
  }
  function updateTradeButtons() {
    const busy = running || optimizing || exploring;
    $('#trade-explore').disabled = busy;
    $('#trade-stop').disabled = !exploring;
    const available = tradeResult && tradeSelected !== null && !tradeStale() && !tradeApplied;
    $('#trade-validate').disabled = busy || !available;
    $('#trade-apply').disabled = busy || !available || tradeValidation?.selectedId !== tradeSelected;
  }
  function tradeBusy(busy) {
    exploring = busy;
    $('#run').disabled = busy || running || optimizing; $('#replay').disabled = busy || optimizing;
    $('#optimize').disabled = busy || running || optimizing;
    $('#opt-apply').disabled = busy || optimizing || optimizationApplied || !optimizationResult || optimizationResult.best.id === 0 || optimizerObjectiveStale();
    updateTradeButtons();
  }
  const deltaText = value => `${value > 0 ? '+' : ''}${fixed(value)}`;
  const tradeName = row => row.references.length ? row.references.join(' / ') : `Candidate ${row.id}`;
  function renderTradeoffs() {
    const result = tradeResult;
    if (!result) return;
    const rows = result.rows.filter(row => row.frontier || row.references.length || row.id === tradeSelected || $('#trade-show-dominated').checked);
    $('#trade-summary').textContent = `${result.rows.filter(row => row.frontier).length} frontier candidates · ${result.space} grid combinations + deduplicated references · ${result.candidatesTested} tested · ${result.options.iterations} fights each · seed ${result.config.seed}. Both finishers: 5 CP. All deltas compare with current settings at 5 CP. No candidate is selected automatically.`;
    $('#trade-table').innerHTML = rows.map(row => `<tr class="${row.id === tradeSelected ? 'trade-selected' : ''}"><td><button type="button" data-trade-id="${row.id}" aria-pressed="${row.id === tradeSelected}">${tradeName(row)}</button><small>${row.frontier ? 'Frontier' : 'Dominated'}</small></td><td>${fixed(row.biteCPM)}</td><td>${deltaText(row.deltas.biteCPM.gain)}</td><td>${fixed(row.ripUptime)}%</td><td>${deltaText(row.deltas.ripUptime.gain)}</td><td>${fixed(row.cpm)}</td><td>${deltaText(row.deltas.attackCPM.gain)}</td><td>${number(row.params.biteMaxEnergy)}</td><td>${number(row.params.biteRipOutside)}</td><td>${number(row.params.biteRipBerserk)}</td><td>${fixed(row.landedBiteCPM)}</td><td>${fixed(row.ordinaryBiteCPM)}</td><td>${fixed(row.terminalBiteCPM)}</td><td>${fixed(row.totalCPM)}</td><td>${fixed(row.totalCasts / row.iterations)}</td></tr>`).join('');
    const maxX = Math.max(0.1, ...result.rows.map(row => row.biteCPM)) * 1.08;
    const minY = Math.max(0, Math.floor(Math.min(...result.rows.map(row => row.ripUptime)) / 5) * 5 - 5);
    const maxY = Math.min(100, Math.ceil(Math.max(...result.rows.map(row => row.ripUptime)) / 5) * 5 + 5);
    const low = Math.min(...result.rows.map(row => row.cpm)), high = Math.max(...result.rows.map(row => row.cpm));
    const color = value => {
      const t = high === low ? 0.5 : (value - low) / (high - low);
      return `rgb(${Math.round(92 + 140 * t)},${Math.round(175 + 10 * t)},${Math.round(224 - 119 * t)})`;
    };
    const ticks = Array.from({ length: 5 }, (_, i) => {
      const x = 65 + i * 650 / 4, y = 310 - i * 270 / 4;
      return `<path d="M${x} 40V310 M65 ${y}H715" stroke="#ffffff12"/><text x="${x}" y="332" text-anchor="middle">${fixed(maxX * i / 4)}</text><text x="55" y="${y + 4}" text-anchor="end">${fixed(minY + (maxY - minY) * i / 4)}%</text>`;
    }).join('');
    // Draw selection last so coincident outcomes remain selectable via the table.
    const points = [...rows].sort((a, b) => Number(a.id === tradeSelected) - Number(b.id === tradeSelected)).map(row => {
      const label = `${tradeName(row)}: Bite ${fixed(row.biteCPM)} CPM; Rip ${fixed(row.ripUptime)}%; attack ${fixed(row.cpm)} CPM; energy ≤${row.params.biteMaxEnergy}; safety ${row.params.biteRipOutside}/${row.params.biteRipBerserk}s`;
      return `<circle cx="${65 + row.biteCPM / maxX * 650}" cy="${310 - (row.ripUptime - minY) / (maxY - minY) * 270}" r="${row.references.length ? 7 : 5}" fill="${color(row.cpm)}" stroke="${row.id === tradeSelected ? '#fff' : '#080d0a'}" stroke-width="${row.id === tradeSelected ? 3 : 1}" opacity="${row.frontier ? 1 : 0.6}" role="button" tabindex="0" data-trade-id="${row.id}" aria-label="${label}" aria-pressed="${row.id === tradeSelected}"><title>${label}</title></circle>`;
    }).join('');
    $('#trade-chart').innerHTML = `<svg viewBox="0 0 760 370" role="group" aria-label="Bite tradeoffs plot"><text x="65" y="22">Rip uptime (full fight; zoomed axis)</text>${ticks}<path d="M65 40V310H715" fill="none" stroke="#ffffff55"/>${points}<text x="390" y="362" text-anchor="middle">Bite CPM (attempted casts)</text></svg>`;
    $('#trade-legend').textContent = `Color: blue ${fixed(low)} → gold ${fixed(high)} attack CPM. Larger points are references; white outline is your selection. Overlapping points can be selected individually in the table.`;
    const selected = result.rows.find(row => row.id === tradeSelected);
    if (!selected) { $('#trade-details').innerHTML = '<p class="panel-note">Select a candidate to inspect Bite costs and Rip recovery.</p>'; return; }
    const { counts, recovery, ripDowntime } = selected;
    const detailRows = [
      ['Finisher CPM (Rip + Bite)', fixed(selected.finisherCPM)],
      ['Rip CPM / Bite CPM', `${fixed(selected.abilityCPM.rip)} / ${fixed(selected.biteCPM)}`],
      ['Energy spent / attempted Bite', fixed(selected.meanBiteEnergy)],
      ['Bites consuming Clearcasting', `${counts.clearcasting} / ${counts.attempts}`],
      ['Bites during Berserk', `${counts.berserk} / ${counts.attempts}`],
      ['Rip downtime / fight: opening', `${fixed(ripDowntime.opening / selected.iterations)}s`],
      ['Rip downtime / fight: maintenance', `${fixed(ripDowntime.maintenance / selected.iterations)}s`],
      ['Rip downtime / fight: terminal', `${fixed(ripDowntime.terminal / selected.iterations)}s`],
      ['Ordinary landed Bites: next Rip observed / censored', `${recovery.observed} / ${recovery.censored}`],
      ['Next Rip before old Rip expired (observed only)', recovery.observed ? `${fixed(recovery.onTime / recovery.observed * 100)}%` : '—'],
      ['Bite → next Rip, mean (observed only)', recovery.observed ? `${fixed(recovery.delayTotal / recovery.observed)}s` : '—'],
      ['Gap past old Rip expiration, mean per observed Bite', recovery.observed ? `${fixed(recovery.gapTotal / recovery.observed)}s` : '—'],
      ['Rake uptime / OOM rate', `${fixed(selected.rakeUptime)}% / ${fixed(selected.oomPercent)}%`]
    ];
    $('#trade-details').innerHTML = `<h3>${tradeName(selected)} · exploration diagnostics</h3><table><tbody>${detailRows.map(([key, value]) => `<tr><td>${key}</td><td>${value}</td></tr>`).join('')}</tbody></table><p class="panel-note">Recovery is an association, not proof Bite caused a gap. Each ordinary landed Bite is linked to its next successful Rip; repeated Bites may share that Rip and gap. Censored means no subsequent Rip before fight end; excluded from recovery means. Downtime totals count each uncovered second once: opening until first Rip, then maintenance versus the final 12s. Terminal Bites use that same final-12s rule. Counts pool all exploration fights.</p>`;
  }
  function renderTradeValidation() {
    if (!tradeValidation) { $('#trade-validation').innerHTML = ''; return; }
    const v = tradeValidation;
    const metrics = [['Bite CPM', 'biteCPM', 'biteCPM'], ['Rip uptime (%) / delta (pp)', 'ripUptime', 'ripUptime'], ['Attack CPM', 'cpm', 'attackCPM']];
    $('#trade-validation').innerHTML = `<h3>Fresh paired validation · ${v.iterations} fights per candidate</h3><p class="panel-note">Iterations ${v.firstIteration}–${v.lastIteration}, disjoint from exploration. Compare selected settings to the current-settings reference, both at 5 CP.</p><div class="table-wrap"><table><thead><tr><th>Metric</th><th>Reference</th><th>Selected</th><th>Δ</th><th>Paired SE</th></tr></thead><tbody>${metrics.map(([name, field, delta]) => `<tr><td>${name}</td><td>${fixed(v.baseline[field])}</td><td>${fixed(v.selected[field])}</td><td>${deltaText(v.deltas[delta].gain)}</td><td>${fixed(v.deltas[delta].se)}</td></tr>`).join('')}</tbody></table></div><p class="panel-note">SE is sampling uncertainty, not a selection-corrected significance test. Validation does not change frontier membership or choose a winner. Revalidating this selection reproduces the same held-out iterations.</p>`;
  }
  function pumpTradeJob(onComplete, validation) {
    const ticket = ++tradeTicket;
    tradeBusy(true);
    function pump() {
      if (ticket !== tradeTicket || !tradeJob) return;
      try {
        const start = Date.now();
        for (let batch = 0; batch < 8; batch++) {
          const next = tradeJob.next();
          if (next.done) {
            tradeJob = null; onComplete(next.value); tradeBusy(false); return;
          }
          const p = next.value;
          $('#trade-progress').max = p.totalFights; $('#trade-progress').value = p.completedFights;
          $('#trade-status').textContent = `${p.phase} ${p.candidateIndex}/${p.candidateCount} · ${number(p.completedFights)}/${number(p.totalFights)} fights · seed ${p.seed}. Settings unchanged.`;
          if (Date.now() - start >= 12) break;
        }
        setTimeout(pump, 0);
      } catch (error) {
        tradeJob = null; tradeValidation = null;
        if (!validation) tradeResult = null;
        renderTradeValidation(); tradeBusy(false);
        $('#trade-status').textContent = `Could not ${validation ? 'validate' : 'explore'}: ${error.message}`;
      }
    }
    setTimeout(pump, 0);
  }
  function exploreBites() {
    if (running || optimizing || exploring) return;
    $('#tradeoff-results').hidden = false;
    tradeResult = null; tradeSelected = null; tradeValidation = null; tradeApplied = false; tradeSnapshot = null;
    for (const id of ['trade-chart', 'trade-table', 'trade-details', 'trade-validation']) $(`#${id}`).innerHTML = '';
    $('#trade-summary').textContent = ''; $('#trade-legend').textContent = '';
    $('#trade-progress').max = 1; $('#trade-progress').value = 0;
    updateTradeButtons();
    try {
      const base = config();
      const parameterValues = Object.fromEntries(tradeoffs.KEYS.map(key => [key, $(`#trade-${key}`).value]));
      const plan = tradeoffs.prepare(base, { parameterValues, iterations: $('#trade-iterations').value });
      const search = { ...base, seed: $('#fresh-seed').checked ? freshSeed(base.seed, lastTradeSeed) : base.seed };
      lastTradeSeed = search.seed; tradeSnapshot = base;
      tradeJob = tradeoffs.explore(search, plan.options);
      $('#trade-status').textContent = `Starting Bite exploration · seed ${search.seed}. Settings unchanged.`;
      pumpTradeJob(result => {
        tradeResult = result; renderTradeoffs();
        $('#trade-status').textContent = tradeStale() ? 'Simulation settings changed. Explore again before validating or applying.' : `Complete: ${result.candidatesTested} candidates · ${number(result.completedFights)} fights. Select a tradeoff to validate.`;
      }, false);
    } catch (error) { $('#trade-status').textContent = `Could not explore: ${error.message}`; }
  }
  function selectTrade(event) {
    if (exploring || optimizing || running || !tradeResult) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('[data-trade-id]');
    if (!target) return;
    const id = Number(target.getAttribute('data-trade-id'));
    if (!tradeResult.rows.some(row => row.id === id)) return;
    if (event.type === 'keydown') event.preventDefault();
    if (tradeSelected !== id) tradeValidation = null;
    tradeSelected = id; renderTradeoffs(); renderTradeValidation(); updateTradeButtons();
  }
  function validateTrade() {
    if (!tradeResult || tradeSelected === null || exploring || optimizing || running || tradeApplied) return;
    if (tradeStale()) { $('#trade-status').textContent = 'Simulation settings changed. Explore again before validating or applying.'; updateTradeButtons(); return; }
    tradeValidation = null; renderTradeValidation();
    tradeJob = tradeoffs.validate(tradeResult, tradeSelected);
    pumpTradeJob(result => {
      tradeValidation = result; renderTradeValidation();
      $('#trade-status').textContent = tradeStale() ? 'Simulation settings changed. Explore again before applying.' : 'Validation complete. Review the tradeoffs and uncertainty; Apply is an explicit choice, not a recommendation.';
    }, true);
  }
  function stopTrade() {
    if (!exploring) return;
    tradeTicket++; tradeJob?.return(); tradeJob = null; tradeValidation = null;
    renderTradeValidation(); tradeBusy(false);
    $('#trade-status').textContent = 'Stopped. No settings or simulation results changed; incomplete results cannot be applied.';
  }
  function applyTrade() {
    if (!tradeResult || !tradeValidation || tradeValidation.selectedId !== tradeSelected || tradeApplied || exploring || optimizing || running) return;
    if (tradeStale()) { $('#trade-status').textContent = 'Simulation settings changed. Explore again before applying.'; updateTradeButtons(); return; }
    const selected = tradeResult.rows.find(row => row.id === tradeSelected);
    for (const [key, value] of Object.entries(selected.params)) $(`#${key}`).value = String(value);
    tradeApplied = true; updateTradeButtons();
    $('#trade-status').textContent = `Selected Bite settings and 5-CP finishers applied. Running with exploration seed ${tradeResult.config.seed}.`;
    run(tradeResult.config.seed);
  }
  $('#trade-explore').addEventListener('click', exploreBites);
  $('#trade-stop').addEventListener('click', stopTrade);
  $('#trade-validate').addEventListener('click', validateTrade);
  $('#trade-apply').addEventListener('click', applyTrade);
  $('#trade-table').addEventListener('click', selectTrade);
  $('#trade-chart').addEventListener('click', selectTrade);
  $('#trade-chart').addEventListener('keydown', selectTrade);
  $('#trade-show-dominated').addEventListener('change', renderTradeoffs);
  for (const event of ['input', 'change']) $('#config').addEventListener(event, () => {
    if (tradeResult && !tradeApplied && tradeStale()) $('#trade-status').textContent = 'Simulation settings changed. Explore again before validating or applying.';
    updateTradeButtons();
  });
  for (const id of ['opt-objective', 'opt-rip-weight', 'opt-bite-weight']) {
    $(`#${id}`).addEventListener('input', updateObjectiveControls);
    $(`#${id}`).addEventListener('change', updateObjectiveControls);
  }
  updateObjectiveControls();
  $('#fresh-seed').addEventListener('change', updateSeedControls);
  updateSeedControls();
  $('#shifting-mode').addEventListener('change', updateShiftingControls);
  updateShiftingControls();
  $('#use-potions').addEventListener('change', updatePotionControls);
  updatePotionControls();
  function updateStartingClearcastingControl() { $('#starting-clearcasting').disabled = !$('#omen-of-clarity').checked; }
  $('#omen-of-clarity').addEventListener('change', updateStartingClearcastingControl);
  updateStartingClearcastingControl();
  $('#log-view').addEventListener('change', updateLog);
  $('#log-autoattacks').addEventListener('change', updateLog);
  $('#log-procs').addEventListener('change', updateLog);
  $('#mana-per-five').addEventListener('change', () => { if (lastResult) render(lastResult); });
  $('#optimize').addEventListener('click', optimizeRotation);
  $('#opt-stop').addEventListener('click', stopOptimization);
  $('#opt-apply').addEventListener('click', applyOptimization);
  optimizerBusy(false);
  $('#run').addEventListener('click', () => run()); $('#replay').addEventListener('click', replay); run();
})();
