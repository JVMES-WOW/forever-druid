(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./feral-sim.js') : root.FOREVER_FERAL_SIM,
    typeof module === 'object' && module.exports ? require('./feral-optimizer.js') : root.FOREVER_FERAL_OPTIMIZER);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FOREVER_FERAL_TRADEOFFS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (sim, optimizer) {
  'use strict';
  const KEYS = ['biteMaxEnergy', 'biteRipOutside', 'biteRipBerserk'];
  const DEFAULT_VALUES = Object.fromEntries(KEYS.map(key => [key, [...optimizer.PARAMETERS[key].values]]));
  const BUDGET = 25000;
  function iterations(value, fallback) {
    const n = Number(value ?? fallback);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('Use 1–1,000 fights per candidate.');
    return n;
  }
  function prepare(input = {}, options = {}) {
    const config = sim.normalize({ ...input, ripMinCP: 5, biteMinCP: 5 });
    const supplied = options.parameterValues || DEFAULT_VALUES;
    if (Object.keys(supplied).some(key => !KEYS.includes(key))) throw new Error('Bite tradeoffs only search Bite energy and the two safety windows.');
    const parameterValues = Object.fromEntries(KEYS.map(key => [key, optimizer.parseValues(supplied[key] ?? DEFAULT_VALUES[key], key)]));
    const count = iterations(options.iterations, 100);
    const space = KEYS.reduce((n, key) => n * parameterValues[key].length, 1);
    if (space * count > BUDGET) throw new Error('Search exceeds the 25,000-fight budget. Reduce grid values or fights per candidate.');
    const candidates = [], seen = new Map();
    const add = (params, reference) => {
      const values = Object.fromEntries(KEYS.map(key => [key, params[key]]));
      const signature = JSON.stringify(values);
      let item = seen.get(signature);
      if (!item) {
        item = { id: candidates.length, params: { ...values, ripMinCP: 5, biteMinCP: 5 }, references: [] };
        candidates.push(item); seen.set(signature, item);
      }
      if (reference) item.references.push(reference);
      return item;
    };
    const baselineId = add(config, 'Current settings (5 CP)').id;
    const terminalId = add({ ...config, biteRipOutside: 30, biteRipBerserk: 30 }, 'Terminal-only control').id;
    // Explicit grid plus references: don't silently expand every axis with current values.
    for (const biteMaxEnergy of parameterValues.biteMaxEnergy)
      for (const biteRipOutside of parameterValues.biteRipOutside)
        for (const biteRipBerserk of parameterValues.biteRipBerserk) add({ biteMaxEnergy, biteRipOutside, biteRipBerserk });
    const totalFights = candidates.length * count;
    if (totalFights > BUDGET) throw new Error('Search including references exceeds the 25,000-fight budget. Reduce grid values or fights per candidate.');
    return { config, options: { parameterValues, iterations: count }, candidates, baselineId, terminalId, space, totalFights };
  }
  function sample(fight) {
    return { duration: fight.duration, attacks: optimizer.attackCount(fight), bites: fight.casts.bite,
      casts: { ...fight.casts }, totalCasts: sim.ABILITIES.reduce((sum, id) => sum + fight.casts[id], 0),
      ripSeconds: fight.uptime.rip * fight.duration / 100, rakeSeconds: fight.uptime.rake * fight.duration / 100,
      oom: fight.oomTime !== null, diagnostics: { ...fight.biteDiagnostics, events: undefined } };
  }
  function summarize(samples) {
    const sum = getter => samples.reduce((n, s) => n + getter(s), 0);
    const duration = sum(s => s.duration);
    const sumObject = getter => Object.fromEntries(Object.keys(getter(samples[0])).map(key => [key, sum(s => getter(s)[key])]));
    const counts = sumObject(s => s.diagnostics.counts), recovery = sumObject(s => s.diagnostics.recovery);
    const ripDowntime = sumObject(s => s.diagnostics.ripDowntime);
    return { iterations: samples.length, duration, cpm: sum(s => s.attacks) * 60 / duration,
      biteCPM: sum(s => s.bites) * 60 / duration, ripUptime: sum(s => s.ripSeconds) * 100 / duration,
      finisherCPM: sum(s => s.casts.rip + s.casts.bite) * 60 / duration,
      rakeUptime: sum(s => s.rakeSeconds) * 100 / duration,
      totalCasts: sum(s => s.totalCasts), totalCPM: sum(s => s.totalCasts) * 60 / duration,
      abilityCPM: Object.fromEntries(optimizer.ATTACKS.map(id => [id, sum(s => s.casts[id]) * 60 / duration])),
      landedBiteCPM: counts.landed * 60 / duration, ordinaryBiteCPM: counts.ordinary * 60 / duration,
      terminalBiteCPM: counts.terminal * 60 / duration, counts, recovery, ripDowntime,
      meanBiteEnergy: counts.attempts ? sum(s => s.diagnostics.energySpent) / counts.attempts : null,
      oomPercent: sum(s => Number(s.oom)) * 100 / samples.length };
  }
  // Ratio-estimator standard error preserves pooled-time weighting. This is
  // paired sampling uncertainty, not a selection-corrected significance test.
  function paired(baseline, candidate, getter, scale) {
    if (!baseline.length || baseline.length !== candidate.length || baseline.some((s, i) => s.duration !== candidate[i].duration)) {
      throw new Error('Paired comparisons require matching fight durations and sample counts.');
    }
    const n = baseline.length, duration = baseline.reduce((sum, s) => sum + s.duration, 0);
    const differences = candidate.map((s, i) => getter(s) - getter(baseline[i]));
    const gain = differences.reduce((sum, d) => sum + d, 0) * scale / duration;
    const residuals = differences.map((d, i) => d - gain * baseline[i].duration / scale);
    return { gain, se: n > 1 ? scale * Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (n - 1) / n) / (duration / n) : null };
  }
  function deltas(base, selected) {
    return { attackCPM: paired(base, selected, s => s.attacks, 60),
      biteCPM: paired(base, selected, s => s.bites, 60), ripUptime: paired(base, selected, s => s.ripSeconds, 100) };
  }
  function dominates(a, b) {
    const keys = ['biteCPM', 'ripUptime', 'cpm'];
    return keys.every(key => a[key] >= b[key]) && keys.some(key => a[key] > b[key]);
  }
  function frontier(rows) {
    return rows.map(row => ({ ...row, frontier: !rows.some(other => other.id !== row.id && dominates(other, row)) }));
  }
  function* explore(input = {}, options = {}) {
    const plan = prepare(input, options);
    const { config, candidates } = plan;
    let completedFights = 0, baselineSamples;
    const rows = [];
    for (const candidate of candidates) {
      const samples = [];
      for (let iteration = 1; iteration <= plan.options.iterations; iteration++) {
        samples.push(sample(sim.simulateFight({ ...config, ...candidate.params }, { iteration, debug: false })));
        completedFights++;
        yield { phase: 'Exploring', candidateIndex: candidate.id + 1, candidateCount: candidates.length,
          completedFights, totalFights: plan.totalFights, seed: config.seed };
      }
      if (candidate.id === plan.baselineId) baselineSamples = samples;
      rows.push({ ...candidate, ...summarize(samples), deltas: deltas(baselineSamples, samples) });
    }
    return { config, options: plan.options, space: plan.space, candidatesTested: candidates.length, completedFights,
      baselineId: plan.baselineId, terminalId: plan.terminalId, rows: frontier(rows), lastIteration: plan.options.iterations };
  }
  function* validate(result, selectedId, options = {}) {
    const selected = result.rows.find(row => row.id === selectedId);
    const baseline = result.rows.find(row => row.id === result.baselineId);
    if (!selected || !baseline) throw new Error('Select a candidate from a completed exploration.');
    const count = iterations(options.iterations, 1000), firstIteration = result.lastIteration + 1;
    const candidates = selected.id === baseline.id ? [baseline] : [baseline, selected];
    const samples = new Map(); let completedFights = 0;
    for (const candidate of candidates) {
      const values = [];
      for (let i = 0; i < count; i++) {
        values.push(sample(sim.simulateFight({ ...result.config, ...candidate.params }, { iteration: firstIteration + i, debug: false })));
        completedFights++;
        yield { phase: 'Validating', candidateIndex: candidates.indexOf(candidate) + 1, candidateCount: candidates.length,
          completedFights, totalFights: count * candidates.length, seed: result.config.seed };
      }
      samples.set(candidate.id, values);
    }
    return { selectedId, iterations: count, firstIteration, lastIteration: firstIteration + count - 1, completedFights,
      baseline: summarize(samples.get(baseline.id)), selected: summarize(samples.get(selected.id)),
      deltas: deltas(samples.get(baseline.id), samples.get(selected.id)) };
  }
  return { KEYS, DEFAULT_VALUES, prepare, sample, summarize, paired, deltas, dominates, frontier, explore, validate };
});
