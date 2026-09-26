(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.FOREVER_RAID_STATE = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const prefix = 'FR1.';
  const normalizeName = value => typeof value === 'string' ? value.trim().slice(0, 40) : '';
  function packText(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64url');
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function unpackText(value) {
    if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64url').toString('utf8');
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  function compact(input, data) {
    if (!input || !data.raidSizes.includes(input.raidSize)) throw new Error('Unsupported raid size.');
    if (!Array.isArray(input.groups) || input.groups.length !== input.raidSize / data.groupSize) throw new Error('Invalid raid groups.');
    const specIds = new Set(data.specs.map(spec => spec.id));
    const campIds = new Set((data.campBuffs || []).map(camp => camp.id));
    const blessingIds = data.blessingIds || [];
    const groupChoiceLabels = data.groupChoiceLabels || {};
    const groups = input.groups.map(group => {
      if (!Array.isArray(group) || group.length !== data.groupSize) throw new Error('Invalid raid group.');
      return group.map(player => {
        if (player == null) return null;
        const specId = data.legacySpecIds[player.specId || player.id] || player.specId || player.id;
        if (!specIds.has(specId)) throw new Error('Unknown specialization.');
        const rawName = player.customName ?? player.name ?? '';
        if (typeof rawName !== 'string' || rawName.length > 200) throw new Error('Invalid character name.');
        const name = normalizeName(rawName);
        if (player.campBuffs !== undefined && !Array.isArray(player.campBuffs)) throw new Error('Invalid camp buffs.');
        const campBuffs = input.raidSize === 5 ? [...new Set(player.campBuffs || [])].slice(0, 1) : [];
        if (campBuffs.some(id => !campIds.has(id))) throw new Error('Unknown camp buff.');
        if (player.blessingPriority !== undefined && (!Array.isArray(player.blessingPriority) || player.blessingPriority.length !== blessingIds.length
          || new Set(player.blessingPriority).size !== blessingIds.length || player.blessingPriority.some(id => !blessingIds.includes(id)))) throw new Error('Invalid blessing priority.');
        const blessingPriority = player.blessingPriority ? [...player.blessingPriority] : null;
        if (blessingPriority) return [specId, name, campBuffs, blessingPriority];
        if (campBuffs.length) return [specId, name, campBuffs];
        return name ? [specId, name] : [specId];
      });
    });
    if (input.groupChoices !== undefined && (!Array.isArray(input.groupChoices) || input.groupChoices.length !== groups.length)) throw new Error('Invalid group choices.');
    const groupChoices = groups.map((_, groupIndex) => {
      const raw = input.groupChoices?.[groupIndex] || {};
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid group choice.');
      const entries = Object.entries(raw).filter(([, effectId]) => effectId != null && effectId !== '');
      for (const [choiceId, effectId] of entries) {
        const buff = data.buffs[effectId];
        const keys = Array.isArray(buff?.exclusive) ? buff.exclusive : (buff?.exclusive ? [buff.exclusive] : []);
        if (!groupChoiceLabels[choiceId] || buff?.scope !== 'party' || !keys.includes(choiceId)) throw new Error('Unknown group choice.');
      }
      return Object.fromEntries(entries);
    });
    const result = { v: 1, s: input.raidSize, g: groups };
    if (groupChoices.some(choice => Object.keys(choice).length)) result.q = groupChoices;
    if (input.bossChoices !== undefined && (!input.bossChoices || typeof input.bossChoices !== 'object' || Array.isArray(input.bossChoices))) throw new Error('Invalid boss choices.');
    const bossChoices = {};
    for (const [recommendationId, choiceId] of Object.entries(input.bossChoices || {})) {
      const recommendation = (data.bossRecommendations || []).find(item => item.id === recommendationId);
      const providerClasses = (recommendation?.effects || []).flatMap(id => Object.keys(data.buffs[id]?.providerVariants || {}));
      if (!recommendation || ![...recommendation.effects, ...providerClasses].includes(choiceId)) throw new Error('Unknown boss choice.');
      bossChoices[recommendationId] = choiceId;
    }
    if (Object.keys(bossChoices).length) result.b = bossChoices;
    return result;
  }
  function encode(input, data) { return prefix + packText(JSON.stringify(compact(input, data))); }
  function decode(code, data) {
    const value = String(code || '').trim();
    if (!value.startsWith(prefix) || value.length > 16000) throw new Error('Invalid raid link.');
    let payload;
    try { payload = JSON.parse(unpackText(value.slice(prefix.length))); } catch (_) { throw new Error('Invalid raid link.'); }
    if (!payload || payload.v !== 1 || !Array.isArray(payload.g)) throw new Error('Unsupported raid link version.');
    const normalized = compact({ raidSize: payload.s, groups: payload.g.map(group => {
      if (!Array.isArray(group)) return group;
      return group.map(item => item == null ? null : ({
        specId: Array.isArray(item) ? item[0] : '',
        name: Array.isArray(item) ? (item[1] || '') : '',
        campBuffs: Array.isArray(item?.[2]) ? item[2] : (Array.isArray(payload.c) ? payload.c : []),
        blessingPriority: Array.isArray(item?.[3]) ? item[3] : undefined
      }));
    }), groupChoices: Array.isArray(payload.q) ? payload.q : undefined, bossChoices: payload.b }, data);
    const result = { raidSize: normalized.s, groups: normalized.g.map(group => group.map(item => {
      if (item == null) return null;
      const player = { specId: item[0], name: item[1] || '' };
      if (item[2]?.length) player.campBuffs = item[2];
      if (item[3]?.length) player.blessingPriority = item[3];
      return player;
    })) };
    if (normalized.q) result.groupChoices = normalized.q;
    if (normalized.b) result.bossChoices = normalized.b;
    return result;
  }
  return { prefix, normalizeName, encode, decode };
});
