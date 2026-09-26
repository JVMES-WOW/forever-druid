(() => {
  const data = globalThis.FOREVER_ABILITY_MOCKUP;
  const iconMap = globalThis.FOREVER_ABILITY_ICONS || {};
  const icon = item => item.iconPath || `ability-icons/${iconMap[item.name]?.file || 'unknown.jpg'}`;
  const rank = item => item.rank ? `Rank ${item.rank}` : (item.kind || 'Ability');
  const categoryFor = name => data.spellbook.find(item => item.name === name)?.category || ({Hurricane:'balance',Innervate:'restoration','Insect Swarm':'balance','Wild Growth':'restoration','Dire Bear Form':'feral','Feline Grace':'feral',Lacerate:'feral'}[name] || 'restoration');
  const dialog = document.querySelector('#ability-tooltip');

  function showTooltip(item, pinned = false) {
    const category = categoryFor(item.name);
    dialog.querySelector('#tooltip-icon').src = icon({...item, category});
    dialog.querySelector('#tooltip-name').textContent = item.name;
    dialog.querySelector('#tooltip-rank').textContent = rank(item);
    const details = dialog.querySelector('#tooltip-details');
    details.replaceChildren(...(item.details || []).map(value => {
      const span = document.createElement('span');
      span.textContent = value;
      return span;
    }));
    dialog.querySelector('#tooltip-description').textContent = item.description;
    dialog.dataset.pinned = pinned ? 'true' : 'false';
    dialog.hidden = false;
  }

  function makeButton(item, suffix = '') {
    const category = categoryFor(item.name);
    const button = document.createElement('button');
    button.className = 'upgrade';
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.title = item.description ? `${item.name} — ${item.description}` : item.name;
    button.innerHTML = `<img src="${icon({...item, category})}" alt=""><div><b></b><span></span></div>`;
    button.querySelector('b').textContent = item.name;
    button.querySelector('span').textContent = `${rank(item)}${suffix}`;
    button.addEventListener('mouseenter', () => showTooltip(item));
    button.addEventListener('focus', () => showTooltip(item));
    button.addEventListener('mouseleave', () => {
      if (dialog.dataset.pinned !== 'true') dialog.hidden = true;
    });
    button.addEventListener('blur', () => {
      if (dialog.dataset.pinned !== 'true') dialog.hidden = true;
    });
    button.addEventListener('click', () => showTooltip(item, true));
    return button;
  }

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
        root.append(makeButton(item));
      });
      container.append(section);
    });
    const unverified = data.trainerUpgrades.filter(item => !Number.isFinite(item.level));
    if (unverified.length) {
      const section = document.createElement('section');
      section.innerHTML = '<div class="level"><span>LEVEL</span><strong>?</strong></div><div class="upgrade-list"></div>';
      const root = section.querySelector('.upgrade-list');
      unverified.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
        root.append(makeButton(item, ' · requirement unverified'));
      });
      container.append(section);
    }
  }

  dialog.querySelector('.tooltip-close').addEventListener('click', () => {
    dialog.dataset.pinned = 'false';
    dialog.hidden = true;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      dialog.dataset.pinned = 'false';
      dialog.hidden = true;
    }
  });
  renderTrainer();
})();
