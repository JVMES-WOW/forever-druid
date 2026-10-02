(function (root) {
  const data = root.FOREVER_DATA || require('./talents.js');
  const talents = data.trees.flatMap(tree => tree.talents.map(talent => ({ ...talent, tree: tree.id })));
  const byId = Object.fromEntries(talents.map(t => [t.id, t]));
  const defaults = { budget: 51, gates: true };
  const total = points => Object.values(points).reduce((sum, n) => sum + n, 0);
  const treeTotal = (points, tree) => talents.filter(t => t.tree === tree).reduce((sum, t) => sum + (points[t.id] || 0), 0);
  const lowerPoints = (points, talent) => talents.filter(t => t.tree === talent.tree && t.row < talent.row).reduce((sum, t) => sum + (points[t.id] || 0), 0);

  function descriptionAtRank(talent, rank) {
    if (!Number.isInteger(rank) || rank < 0 || rank > talent.max) throw new RangeError('Invalid effect rank.');
    // Unlearned talents preview their first rank, not a fictitious zero effect.
    return talent.rankDescriptions?.[Math.max(1, rank) - 1] || talent.description;
  }

  function requirements(points, talent, rules = defaults) {
    if (!rules.gates) return '';
    if (lowerPoints(points, talent) < (talent.row - 1) * 5) return `Requires ${(talent.row - 1) * 5} points in earlier ${data.trees.find(t => t.id === talent.tree).name} rows.`;
    const parent = byId[talent.prerequisite];
    if (parent && (points[parent.id] || 0) < parent.max) return `Requires ${parent.max}/${parent.max} ${parent.name}.`;
    return '';
  }

  function validate(points, rules = defaults) {
    if (!points || typeof points !== 'object' || Array.isArray(points)) return 'Invalid build.';
    if (!Number.isInteger(rules.budget) || rules.budget < 1 || rules.budget > 200 || typeof rules.gates !== 'boolean') return 'Invalid calculator rules.';
    for (const [id, rank] of Object.entries(points)) {
      if (!Object.hasOwn(byId, id) || !Number.isInteger(rank) || rank < 0 || rank > byId[id].max) return 'Invalid talent or rank.';
    }
    if (total(points) > rules.budget) return 'The build exceeds the point budget.';
    for (const talent of talents) {
      if (points[talent.id]) {
        const problem = requirements(points, talent, rules);
        if (problem) return `${talent.name}: ${problem}`;
      }
    }
    return '';
  }

  function change(points, id, delta, rules = defaults) {
    const talent = byId[id];
    if (!talent || ![-1, 1].includes(delta)) return { error: 'Invalid talent change.' };
    const rank = (points[id] || 0) + delta;
    if (rank < 0) return { error: 'No point to refund.' };
    if (rank > talent.max) return { error: `${talent.name} is at maximum rank.` };
    const next = { ...points, [id]: rank };
    if (!rank) delete next[id];
    const error = validate(next, rules);
    return error ? { error: delta < 0 ? `Refund dependent talents first. ${error}` : error } : { points: next };
  }

  function encode(points, rules = defaults) {
    const error = validate(points, rules);
    if (error) throw new Error(error);
    const ranks = Object.entries(points).filter(([, rank]) => rank > 0)
      .sort(([a], [b]) => a.localeCompare(b)).map(([id, rank]) => `${id}:${rank}`).join(',') || '-';
    // Name each talent and class so future display-order changes cannot move points.
    return `FF4.${data.gameClass}.${rules.budget}.${Number(rules.gates)}.${ranks}`;
  }
  function decode(code) {
    const invalid = () => new Error(`This is not a valid Forever ${data.name || 'Druid'} build code.`);
    if (typeof code !== 'string' || code.length > 10000) throw invalid();
    const current = /^FF4\.([a-z]+)\.(\d{1,3})\.([01])\.(-|[a-z][a-z0-9-]*:[1-5](?:,[a-z][a-z0-9-]*:[1-5])*)$/.exec(code.trim());
    if (current) {
      if (current[1] !== data.gameClass) throw invalid();
      const rules = { budget: Number(current[2]), gates: Number(current[3]) === 1 };
      const entries = current[4] === '-' ? [] : current[4].split(',').map(entry => {
        const [id, rank] = entry.split(':');
        return [id, Number(rank)];
      });
      if (new Set(entries.map(([id]) => id)).size !== entries.length) throw invalid();
      const points = Object.fromEntries(entries);
      const error = validate(points, rules);
      if (error) throw new Error(error);
      return { points, rules };
    }
    const match = /^FF([23])\.(\d{1,3})\.([01])\.([0-5]+)$/.exec(code.trim());
    if (!match) throw invalid();
    const layout = data.legacyBuilds?.[`FF${match[1]}`];
    if (!layout) throw invalid();
    const rules = { budget: Number(match[2]), gates: Number(match[3]) === 1 };
    const rulesError = validate({}, rules);
    if (rulesError) throw new Error(rulesError);
    let ranks = match[4];
    if ([...ranks].reduce((sum, rank) => sum + Number(rank), 0) > rules.budget) throw new Error('The build exceeds the point budget.');
    const refunded = [];
    const notices = [];
    if (data.gameClass === 'druid' && match[1] === '2' && ranks.length === layout.length + 1) {
      if (Number(ranks[8])) refunded.push({ name: 'Balance of Nature', rank: Number(ranks[8]) });
      ranks = ranks.slice(0, 8) + ranks.slice(9);
    }
    if (ranks.length !== layout.length || layout.some(([, max], i) => Number(ranks[i]) > max)) throw invalid();
    const oldPoints = Object.fromEntries(layout.map(([id], i) => [id, Number(ranks[i])]).filter(([, rank]) => rank));
    // Retain the already-published conversion for pre-Shifting Power Druid builds.
    if (data.gameClass === 'druid' && match[1] === '2' && oldPoints['king-of-the-jungle']) {
      const branch = (oldPoints['shredding-attacks'] || 0) + oldPoints['king-of-the-jungle'];
      oldPoints['shredding-attacks'] = Math.min(3, branch);
      oldPoints['shifting-power'] = Math.min(1, Math.max(0, branch - 3));
      oldPoints['improved-shifting-power'] = Math.min(2, Math.max(0, branch - 4));
      delete oldPoints['king-of-the-jungle'];
      notices.push('King of the Jungle points were moved into the Shifting Power branch.');
    }
    const aliases = { 'hot-streak': 'heating-up', 'soul-harvesting': 'soul-harvest' };
    const points = {};
    for (const [oldId, rank] of Object.entries(oldPoints)) {
      if (!rank) continue;
      const id = aliases[oldId] || oldId;
      if (byId[id]) points[id] = rank;
      else refunded.push({ name: oldId.replaceAll('-', ' '), rank });
    }
    // Removed talents and changed gates may invalidate dependents. Refund them
    // visibly rather than silently assigning their points to a different talent.
    let changed;
    do {
      changed = false;
      for (const talent of talents) {
        if (points[talent.id] && requirements(points, talent, rules)) {
          refunded.push({ name: talent.name, rank: points[talent.id] });
          delete points[talent.id];
          changed = true;
        }
      }
    } while (changed);
    const error = validate(points, rules);
    if (error) throw new Error(error);
    if (refunded.length) {
      const count = refunded.reduce((sum, item) => sum + item.rank, 0);
      notices.push(`Talent trees changed: ${count} point${count === 1 ? '' : 's'} refunded from removed talents or unmet requirements (${refunded.map(item => item.name).join(', ')}).`);
    }
    return notices.length ? { points, rules, notice: notices.join(' ') } : { points, rules };
  }
  root.FOREVER_CALCULATOR = { talents, byId, defaults, total, treeTotal, descriptionAtRank, requirements, validate, change, encode, decode };
  if (typeof module !== 'undefined') module.exports = root.FOREVER_CALCULATOR;
})(globalThis);
