(() => {
  const data = globalThis.FOREVER_ABILITY_MOCKUP;
  const iconMap = globalThis.FOREVER_ABILITY_ICONS || {};
  const icon = item => `ability-icons/${iconMap[item.name]?.file || 'unknown.jpg'}`;
  const rank = item => item.rank ? `Rank ${item.rank}` : (item.kind || 'Ability');
  const categoryFor = name => data.spellbook.find(item => item.name === name)?.category || ({Hurricane:'balance',Innervate:'restoration','Insect Swarm':'balance','Wild Growth':'restoration','Dire Bear Form':'feral','Feline Grace':'feral',Lacerate:'feral'}[name] || 'restoration');

  function renderTrainer() {
    const container = document.querySelector('#trainer-levels');
    const levels = [...new Set(data.trainerUpgrades.map(item => item.level).filter(Number.isFinite))].sort((a, b) => a - b);
    levels.forEach(level => {
      const section = document.createElement('section');
      section.innerHTML = `<div class="level"><span>REQUIRES LEVEL</span><strong></strong></div><div class="upgrade-list"></div>`;
      section.querySelector('strong').textContent = level;
      const root = section.querySelector('.upgrade-list');
      data.trainerUpgrades
        .filter(item => item.level === level)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(item => {
        const category = categoryFor(item.name);
        const button = document.createElement('button');
        button.className = 'upgrade';
        button.innerHTML = `<img src="${icon({...item, category})}" alt=""><div><b></b><span></span></div>`;
        button.querySelector('b').textContent = item.name;
        button.querySelector('span').textContent = rank(item);
        root.append(button);
      });
      container.append(section);
    });
    const unverified = data.trainerUpgrades.filter(item => !Number.isFinite(item.level));
    if (unverified.length) {
      const section = document.createElement('section');
      section.innerHTML = '<div class="level"><span>LEVEL</span><strong>?</strong></div><div class="upgrade-list"></div>';
      const root = section.querySelector('.upgrade-list');
      unverified.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
        const category = categoryFor(item.name);
        const button = document.createElement('button');
        button.className = 'upgrade';
        button.innerHTML = `<img src="${icon({...item, category})}" alt=""><div><b></b><span></span></div>`;
        button.querySelector('b').textContent = item.name;
        button.querySelector('span').textContent = `${rank(item)} · requirement unverified`;
        root.append(button);
      });
      container.append(section);
    }
  }

  renderTrainer();
})();
