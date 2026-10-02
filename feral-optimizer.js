(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./feral-sim.js') : root.FOREVER_FERAL_SIM);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FOREVER_FERAL_OPTIMIZER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (sim) {
  'use strict';

  const ATTACKS = ['rake', 'shred', 'rip', 'bite'];
  const PARAMETERS = Object.freeze({
    shiftingThreshold: { label: 'Shifting threshold', min: 0, max: 100, values: [20, 30, 40, 45, 50, 55, 60] },
    biteMaxEnergy: { label: 'Bite max energy', min: 35, max: 100, values: [35, 40, 45, 50, 60] },
    biteRipOutside: { label: 'Bite Rip safety', min: 0, max: 30, values: [0, 2, 4, 6, 8, 10, 12] },
    biteRipBerserk: { label: 'Berserk Bite safety', min: 0, max: 30, values: [0, 2, 4, 6, 8, 10, 12] },
    ripMinCP: { label: 'Rip minimum CP', min: 1, max: 5, integer: true, values: [1, 2, 3, 4, 5] },
    biteMinCP: { label: 'Bite minimum CP', min: 1, max: 5, integer: true, values: [1, 2, 3, 4, 5] }
  });
  const PRESETS = Object.freeze({
    quick: { candidateLimit: 24, screeningIterations: 8, validationIterations: 80, finalists: 3 },
    standard: { candidateLimit: 64, screeningIterations: 20, validationIterations: 200, finalists: 5 },
    thorough: { candidateLimit: 128, screeningIterations: 50, validationIterations: 500, finalists: 8 }
  });

  function normalizeObjective(options = {}) {
    const objective = options.objective || 'attack';
    if (!['attack', 'finishers', 'weightedFinishers'].includes(objective)) throw new Error('Unknown optimizer objective.');
    const result = { objective, ripWeight: 1, biteWeight: 1 };
    if (objective === 'weightedFinishers') {
      for (const key of ['ripWeight', 'biteWeight']) {
        const input = options[key] ?? 1, value = Number(input);
        if (String(input).trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) {
          throw new Error('Rip and Bite weights must be numbers between 0 and 100.');
        }
        result[key] = value;
      }
      if (result.ripWeight + result.biteWeight === 0) throw new Error('At least one finisher weight must be greater than zero.');
    }
    return result;
  }
  function objectiveLabel(options = {}) {
    const c = normalizeObjective(options);
    return c.objective === 'attack' ? 'Attack CPM' : c.objective === 'finishers' ? 'Finisher CPM'
      : `Weighted finishers (${c.ripWeight} × Rip + ${c.biteWeight} × Bite) / min`;
  }
  function objectiveCount(sample, options = {}) {
    if (!options.objective || options.objective === 'attack') return sample.attacks;
    if (options.objective === 'finishers') return sample.casts.rip + sample.casts.bite;
    return sample.casts.rip * options.ripWeight + sample.casts.bite * options.biteWeight;
  }
  // Attack CPM remains a secondary preference when finisher scores tie.
  function compareScores(a, b) { return b.score - a.score || b.cpm - a.cpm; }

  function parseValues(input, key) {
    const parameter = PARAMETERS[key];
    if (!parameter) throw new Error(`Unknown rotation parameter: ${key}`);
    const items = typeof input === 'string' ? input.split(',').map(item => item.trim()) : input;
    if (!Array.isArray(items) || !items.length || items.length > 32 || items.some(item => item === '' || item == null)) {
      throw new Error(`${parameter.label}: enter 1–32 comma-separated numbers.`);
    }
    const values = items.map(Number);
    if (values.some(value => !Number.isFinite(value) || value < parameter.min || value > parameter.max || (parameter.integer && !Number.isInteger(value)))) {
      throw new Error(`${parameter.label}: values must be ${parameter.integer ? 'whole numbers ' : ''}between ${parameter.min} and ${parameter.max}.`);
    }
    return [...new Set(values)].sort((a, b) => a - b);
  }
  function normalizeOptions(options = {}) {
    const preset = options.preset || 'standard';
    if (!PRESETS[preset]) throw new Error('Unknown optimizer search size.');
    const result = { ...PRESETS[preset], ...options, preset, ...normalizeObjective(options) };
    for (const [key, max] of [['candidateLimit', 256], ['screeningIterations', 500], ['validationIterations', 1000], ['finalists', 16]]) {
      if (!Number.isInteger(result[key]) || result[key] < 1 || result[key] > max) throw new Error(`Invalid optimizer ${key}.`);
    }
    const supplied = options.parameterValues ?? Object.fromEntries(Object.entries(PARAMETERS).map(([key, parameter]) => [key, parameter.values]));
    if (!supplied || !Object.keys(supplied).length) throw new Error('Select at least one parameter to optimize.');
    result.parameterValues = Object.fromEntries(Object.entries(supplied).map(([key, values]) => [key, parseValues(values, key)]));
    if (result.candidateLimit * result.screeningIterations + (result.finalists + 1) * result.validationIterations > 25000) {
      throw new Error('Search is too large: reduce candidates or iterations (25,000-fight limit).');
    }
    return result;
  }
  function rotation(config) {
    return Object.fromEntries(Object.keys(PARAMETERS).map(key => [key, config[key]]));
  }
  function makeCandidates(config, options) {
    const keys = Object.keys(PARAMETERS).filter(key => Object.hasOwn(options.parameterValues, key)
      && (key !== 'shiftingThreshold' || config.shiftingMode === 'manual'));
    const domains = keys.map(key => [...new Set([config[key], ...options.parameterValues[key]])].sort((a, b) => a - b));
    const space = domains.reduce((total, domain) => total * domain.length, 1);
    const limit = Math.min(space, options.candidateLimit), candidates = [], seen = new Set();
    const base = rotation(config);
    const add = params => {
      const signature = JSON.stringify(params);
      if (!seen.has(signature)) { seen.add(signature); candidates.push({ id: candidates.length, params }); }
    };
    const decode = index => {
      const params = { ...base };
      keys.forEach((key, i) => { params[key] = domains[i][index % domains[i].length]; index = Math.floor(index / domains[i].length); });
      return params;
    };
    add(base); // Always compare against the exact current settings.
    if (space <= limit) {
      for (let index = 0; index < space; index++) add(decode(index));
    } else {
      // Spend half the budget on single-parameter changes, interleaved by
      // parameter; spend the rest on joint combinations. No combat RNG used.
      const alternatives = domains.map((domain, i) => domain.filter(value => value !== config[keys[i]])
        .sort((a, b) => Math.abs(a - config[keys[i]]) - Math.abs(b - config[keys[i]]) || a - b));
      const axisLimit = Math.ceil(limit / 2);
      for (let row = 0; row < Math.max(...alternatives.map(values => values.length)) && candidates.length < axisLimit; row++) {
        for (let i = 0; i < keys.length && candidates.length < axisLimit; i++) {
          if (row < alternatives[i].length) add({ ...base, [keys[i]]: alternatives[i][row] });
        }
      }
      const rng = sim.createRng(sim.deriveSeed(config.seed, 0x4f505449));
      for (let attempt = 0; candidates.length < limit && attempt < limit * 40; attempt++) add(decode(Math.floor(rng() * space)));
      for (let index = 0; candidates.length < limit; index++) add(decode(index));
    }
    return { candidates, space, exhaustive: candidates.length === space };
  }
  function attackCount(fight) { return ATTACKS.reduce((sum, id) => sum + fight.casts[id], 0); }
  function summarize(samples, options = {}) {
    const scoring = normalizeObjective(options);
    const duration = samples.reduce((sum, sample) => sum + sample.duration, 0);
    const casts = samples.reduce((sum, sample) => sum + sample.attacks, 0);
    const abilityCPM = Object.fromEntries(ATTACKS.map(id => [id, samples.reduce((sum, sample) => sum + sample.casts[id], 0) * 60 / duration]));
    return { cpm: casts * 60 / duration, duration, casts, iterations: samples.length, abilityCPM,
      finisherCPM: samples.reduce((sum, sample) => sum + sample.casts.rip + sample.casts.bite, 0) * 60 / duration,
      score: samples.reduce((sum, sample) => sum + objectiveCount(sample, scoring), 0) * 60 / duration,
      totalCPM: samples.reduce((sum, sample) => sum + sample.totalCasts, 0) * 60 / duration,
      rakeUptime: samples.reduce((sum, sample) => sum + sample.rakeUptime * sample.duration, 0) / duration,
      ripUptime: samples.reduce((sum, sample) => sum + sample.ripUptime * sample.duration, 0) / duration,
      oomPercent: samples.filter(sample => sample.oom).length * 100 / samples.length };
  }
  function pairedGain(baseline, candidate, options = {}) {
    const scoring = normalizeObjective(options);
    const n = baseline.length, duration = baseline.reduce((sum, sample) => sum + sample.duration, 0);
    const deltas = candidate.map((sample, i) => objectiveCount(sample, scoring) - objectiveCount(baseline[i], scoring));
    const gain = deltas.reduce((sum, delta) => sum + delta, 0) * 60 / duration;
    // Paired ratio-estimator SE: preserve pooled-time weighting for varied
    // durations instead of averaging equally weighted per-fight CPMs.
    const residuals = deltas.map((delta, i) => delta - gain * baseline[i].duration / 60);
    const se = n > 1 ? 60 * Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / (n - 1) / n) / (duration / n) : null;
    return { gain, se };
  }

  // Each yield follows one fight, allowing the browser to render progress and
  // cancel between fights. This also works from local file previews: no worker
  // URL, server, dependency, or network access is needed.
  function* optimize(input = {}, inputOptions = {}) {
    const config = sim.normalize(input);
    const activeInput = { ...inputOptions };
    if (config.shiftingMode === 'automatic' && inputOptions.parameterValues) {
      activeInput.parameterValues = Object.fromEntries(Object.entries(inputOptions.parameterValues).filter(([key]) => key !== 'shiftingThreshold'));
      if (!Object.keys(activeInput.parameterValues).length) throw new Error('Automatic shifting has no threshold to optimize. Select another parameter or use manual shifting.');
    }
    const options = normalizeOptions(activeInput);
    if (config.shiftingMode === 'automatic') delete options.parameterValues.shiftingThreshold;
    const { candidates, space, exhaustive } = makeCandidates(config, options);
    const finalistCount = Math.min(candidates.length, options.finalists + 1);
    let completedFights = 0;
    let totalFights = candidates.length * options.screeningIterations + finalistCount * options.validationIterations;
    function* evaluate(candidate, iterations, offset, phase, candidateIndex, candidateCount) {
      const samples = [], candidateConfig = { ...config, ...candidate.params, debug: false };
      for (let i = 1; i <= iterations; i++) {
        const fight = sim.simulateFight(candidateConfig, { iteration: offset + i, debug: false });
        samples.push({ duration: fight.duration, attacks: attackCount(fight), casts: Object.fromEntries(ATTACKS.map(id => [id, fight.casts[id]])),
          totalCasts: sim.ABILITIES.reduce((sum, id) => sum + fight.casts[id], 0),
          rakeUptime: fight.uptime.rake, ripUptime: fight.uptime.rip, oom: fight.oomTime !== null });
        completedFights++;
        yield { phase, candidateIndex, candidateCount, completedFights, totalFights, seed: config.seed };
      }
      return { candidate, samples, summary: summarize(samples, options) };
    }
    const screened = [];
    for (let i = 0; i < candidates.length; i++) screened.push(yield* evaluate(candidates[i], options.screeningIterations, 0, 'Screening', i + 1, candidates.length));
    screened.sort((a, b) => compareScores(a.summary, b.summary) || a.candidate.id - b.candidate.id);
    const finalists = [candidates[0], ...screened.filter(item => item.candidate.id !== 0).slice(0, options.finalists).map(item => item.candidate)];
    totalFights = completedFights + finalists.length * options.validationIterations;
    const validated = [];
    for (let i = 0; i < finalists.length; i++) validated.push(yield* evaluate(finalists[i], options.validationIterations, options.screeningIterations, 'Validation', i + 1, finalists.length));
    const baseline = validated[0];
    const ranked = validated.map(item => {
      const scoreDelta = pairedGain(baseline.samples, item.samples, options);
      return { id: item.candidate.id, params: item.candidate.params, ...item.summary,
        ...pairedGain(baseline.samples, item.samples), scoreGain: scoreDelta.gain, scoreSe: scoreDelta.se };
    }).sort((a, b) => compareScores(a, b) || a.id - b.id);
    return { config, options, candidatesTested: candidates.length, space, exhaustive, completedFights,
      validationFirstIteration: options.screeningIterations + 1, validationLastIteration: options.screeningIterations + options.validationIterations,
      baseline: ranked.find(item => item.id === 0), best: ranked[0], ranked };
  }

  return { ATTACKS, PARAMETERS, PRESETS, normalizeObjective, objectiveLabel, objectiveCount, compareScores,
    parseValues, normalizeOptions, makeCandidates, attackCount, summarize, pairedGain, optimize };
});
