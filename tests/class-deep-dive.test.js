const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function load(className = 'druid') {
  for (const file of ['talents.js', 'calculator.js']) delete require.cache[path.join(root, file)];
  delete globalThis.FOREVER_CLASSES;
  delete globalThis.FOREVER_DATA;
  delete globalThis.FOREVER_CALCULATOR;
  globalThis.location = { search: className === 'druid' ? '' : `?class=${className}` };
  require(path.join(root, 'talents.js'));
  require(path.join(root, 'calculator.js'));
  return { data: globalThis.FOREVER_DATA, calc: globalThis.FOREVER_CALCULATOR };
}

test('the updated Feral tree has 20 nodes and 51 maximum points', () => {
  const { data, calc } = load();
  const feral = data.trees.find(tree => tree.id === 'feral-combat');

  assert.equal(feral.talents.length, 20);
  assert.equal(feral.talents.reduce((sum, talent) => sum + talent.max, 0), 51);
  assert.deepEqual(
    ['shredding-attacks', 'shifting-power', 'improved-shifting-power'].map(id => {
      const talent = calc.byId[id];
      return [id, talent.row, talent.col, talent.max, talent.prerequisite];
    }),
    [
      ['shredding-attacks', 3, 1, 3, undefined],
      ['shifting-power', 4, 1, 1, 'shredding-attacks'],
      ['improved-shifting-power', 5, 1, 2, 'shifting-power']
    ]
  );
  assert.equal(calc.byId['predatory-instincts'].col, 3);
  assert.equal(calc.byId['king-of-the-jungle'], undefined);
  assert.equal(calc.byId.ferocity.max, 5);
  assert.equal(calc.byId['shifting-power'].icon, 'ability-icons/displacer-beast.jpg');
  assert.equal(calc.byId['improved-shifting-power'].icon, 'ability-icons/tigers-fury.jpg');
});

test('Shifting Power prerequisites use the existing full-rank enforcement', () => {
  const { calc } = load();
  const fifteenEarlierPoints = {
    ferocity: 5,
    'heart-of-the-wild': 5,
    'feral-swiftness': 2,
    'feral-instinct': 3
  };

  assert.match(calc.requirements(fifteenEarlierPoints, calc.byId['shifting-power']), /Requires 3\/3 Shredding Attacks/);
  assert.equal(calc.requirements({ ...fifteenEarlierPoints, 'shredding-attacks': 3 }, calc.byId['shifting-power']), '');
  assert.match(calc.requirements({ ...fifteenEarlierPoints, 'shredding-attacks': 3, 'savage-fury': 2 }, calc.byId['improved-shifting-power']), /Requires 1\/1 Shifting Power/);
});

test('new Druid codes use FF3 while zeroed FF2 builds remain importable', () => {
  const { calc } = load();
  assert.match(calc.encode({}), /^FF3\./);
  const previousTalentCount = calc.talents.length - 1;
  const imported = calc.decode(`FF2.51.1.${'0'.repeat(previousTalentCount)}`);
  assert.deepEqual(imported.points, {});
  assert.deepEqual(imported.rules, { budget: 51, gates: true });
});

test('old King of the Jungle points migrate into the Shifting Power branch', () => {
  const { calc } = load();
  const ranks = Array(calc.talents.length - 1).fill(0);
  for (const [index, rank] of [[16, 5], [17, 5], [18, 2], [19, 3], [20, 2], [21, 3], [25, 3], [31, 3]]) ranks[index] = rank;
  const imported = calc.decode(`FF2.51.1.${ranks.join('')}`);
  assert.equal(imported.points['shredding-attacks'], 3);
  assert.equal(imported.points['shifting-power'], 1);
  assert.equal(imported.points['improved-shifting-power'], 2);
  assert.equal(calc.total(imported.points), 26);
});

test('published Hunter talent updates remain present', () => {
  const { calc } = load('hunter');
  assert.equal(calc.byId['summon-hawk'].row, 4);
  assert.equal(calc.byId['lone-wolf'].row, 3);
  assert.equal(calc.byId['trueshot-aura'].row, 4);
  assert.equal(calc.byId['counterattack'].row, 4);
  assert.equal(calc.byId['strider-kick'].row, 5);
  assert.equal(calc.byId['lacerating-strikes'].row, 7);
});
