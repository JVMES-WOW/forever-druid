(function (root) {
  const data = root.FOREVER_DATA || require('./talents.js');
  const talents = data.trees.flatMap(tree => tree.talents.map(talent => ({ ...talent, tree: tree.id })));
  const byId = Object.fromEntries(talents.map(t => [t.id, t]));
  const defaults = { budget: 51, gates: true };
  const total = points => Object.values(points).reduce((sum, n) => sum + n, 0);
  const treeTotal = (points, tree) => talents.filter(t => t.tree === tree).reduce((sum, t) => sum + (points[t.id] || 0), 0);
  const lowerPoints = (points, talent) => talents.filter(t => t.tree === talent.tree && t.row < talent.row).reduce((sum, t) => sum + (points[t.id] || 0), 0);

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
    return 'FF2.' + rules.budget + '.' + Number(rules.gates) + '.' + talents.map(t => points[t.id] || 0).join('');
  }
  function decode(code) {
    const match = /^FF2\.(\d{1,3})\.([01])\.([0-5]+)$/.exec(code.trim());
    if (!match || match[3].length !== talents.length) throw new Error('This is not a valid Forever Druid build code.');
    const rules = { budget: Number(match[1]), gates: match[2] === '1' };
    const points = Object.fromEntries(talents.map((t, i) => [t.id, Number(match[3][i])]).filter(([, n]) => n));
    const error = validate(points, rules);
    if (error) throw new Error(error);
    return { points, rules };
  }
  root.FOREVER_CALCULATOR = { talents, byId, defaults, total, treeTotal, requirements, validate, change, encode, decode };
  if (typeof module !== 'undefined') module.exports = root.FOREVER_CALCULATOR;
})(globalThis);
