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
      if (!byId[id] || !Number.isInteger(rank) || rank < 0 || rank > byId[id].max) return 'Invalid talent or rank.';
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
    const format = data.gameClass === 'druid' && data.version >= 5 ? 'FF3' : 'FF2';
    return format + '.' + rules.budget + '.' + Number(rules.gates) + '.' + talents.map(t => points[t.id] || 0).join('');
  }
  function decode(code) {
    const match = /^FF([23])\.(\d{1,3})\.([01])\.([0-5]+)$/.exec(code.trim());
    if (!match) throw new Error(`This is not a valid Forever ${data.name || 'Druid'} build code.`);
    const format = Number(match[1]);
    let ranks = match[4];
    if (data.gameClass === 'druid' && data.version >= 5 && format === 2) {
      // FF2 Druid builds predate Shifting Power. The oldest form also contains
      // the retired Balance of Nature digit, which is removed first.
      if (ranks.length === talents.length) ranks = ranks.slice(0, 8) + ranks.slice(9);
      if (ranks.length !== talents.length - 1) throw new Error(`This is not a valid Forever ${data.name || 'Druid'} build code.`);
      const oldFeralStart = data.trees[0].talents.length;
      const oldShreddingAttacks = oldFeralStart + 9;
      const oldKingOfTheJungle = oldFeralStart + 15;
      const oldRestorationStart = oldFeralStart + 19;
      // Move old King of the Jungle points into the replacement branch in
      // prerequisite order so the allocation and tier totals remain valid.
      const replacementPoints = Number(ranks[oldShreddingAttacks]) + Number(ranks[oldKingOfTheJungle]);
      const shreddingRank = Math.min(3, replacementPoints);
      const branchPoints = replacementPoints - shreddingRank;
      const shiftingRank = Math.min(1, branchPoints);
      const improvedRank = Math.min(2, Math.max(0, branchPoints - shiftingRank));
      ranks = ranks.slice(0, oldShreddingAttacks) + shreddingRank + ranks.slice(oldShreddingAttacks + 1);
      ranks = ranks.slice(0, oldKingOfTheJungle) + improvedRank + ranks.slice(oldKingOfTheJungle + 1);
      ranks = ranks.slice(0, oldRestorationStart) + shiftingRank + ranks.slice(oldRestorationStart);
    } else if (ranks.length !== talents.length) {
      throw new Error(`This is not a valid Forever ${data.name || 'Druid'} build code.`);
    }
    const rules = { budget: Number(match[2]), gates: match[3] === '1' };
    const points = Object.fromEntries(talents.map((t, i) => [t.id, Number(ranks[i])]).filter(([, n]) => n));
    const error = validate(points, rules);
    if (error) throw new Error(error);
    return { points, rules };
  }
  root.FOREVER_CALCULATOR = { talents, byId, defaults, total, treeTotal, descriptionAtRank, requirements, validate, change, encode, decode };
  if (typeof module !== 'undefined') module.exports = root.FOREVER_CALCULATOR;
})(globalThis);
