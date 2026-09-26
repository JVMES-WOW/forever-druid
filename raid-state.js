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
        if (campBuffs.length) return [specId, name, campBuffs];
        return name ? [specId, name] : [specId];
      });
    });
    return { v: 1, s: input.raidSize, g: groups };
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
        campBuffs: Array.isArray(item?.[2]) ? item[2] : (Array.isArray(payload.c) ? payload.c : [])
      }));
    }) }, data);
    return { raidSize: normalized.s, groups: normalized.g.map(group => group.map(item => {
      if (item == null) return null;
      const player = { specId: item[0], name: item[1] || '' };
      if (item[2]?.length) player.campBuffs = item[2];
      return player;
    })) };
  }
  return { prefix, normalizeName, encode, decode };
});
