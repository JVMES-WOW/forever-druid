(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.FOREVER_RAID_ENGINE = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const eligible = (buff, player) => buff.helps === 'all' || player.tags.includes(buff.helps);
  const active = buff => buff?.status === 'confirmed';
  const exclusiveKeys = buff => Array.isArray(buff.exclusive) ? buff.exclusive : (buff.exclusive ? [buff.exclusive] : []);
  function analyze(groups, data, options = {}) {
    const players = groups.flat().filter(Boolean);
    const blessingIds = data.blessingIds || ['kings','might','wisdom','salvation'];
    const campById = Object.fromEntries((data.campBuffs || []).map(camp => [camp.id, camp]));
    const playerCampBuffs = new Map(players.map(player => {
      const ids = options.campAssignments?.[player.uid] || player.campBuffs || [];
      return [player.uid, [...new Set(ids)].map(id => campById[id]).filter(Boolean).slice(0, 1)];
    }));
    const groupByPlayer = new Map(groups.flatMap((group, groupIndex) => group.filter(Boolean).map(player => [player.uid, groupIndex])));
    const requestedGroupChoices = groups.map((_, groupIndex) => options.groupChoices?.[groupIndex] || {});
    const requestedBossChoices = options.bossChoices || {};
    const selectedCampBuffs = [...new Map([...playerCampBuffs.values()].flat().map(camp => [camp.id, camp])).values()];
    const campCoverage = {};
    for (const player of players) for (const camp of playerCampBuffs.get(player.uid)) {
      for (const buffId of camp.covers) (campCoverage[buffId] ||= []).push({ camp, player });
    }
    const assignedCampFor = (player, buffId, preferredOnly = false) => {
      const groupIndex = groupByPlayer.get(player.uid);
      return groups[groupIndex]?.filter(Boolean).flatMap(provider => playerCampBuffs.get(provider.uid) || [])
        .find(camp => camp.covers.includes(buffId) && (!preferredOnly || camp.preferCamp));
    };
    const paladinCount = players.filter(player => player.classId === 'paladin').length;
    const blessingPriorities = new Map(players.map(player => {
      const requested = options.blessingPriorities?.[player.uid] || player.blessingPriority || [];
      const normalized = [...new Set(requested)].filter(id => blessingIds.includes(id));
      return [player.uid, [...normalized, ...blessingIds.filter(id => !normalized.includes(id))]];
    }));
    const blessingAssignments = new Map(players.map(player => {
      const priority = blessingPriorities.get(player.uid).filter(id => eligible(data.buffs[id], player));
      const camps = priority.filter(id => assignedCampFor(player, id, true));
      const paladinBlessings = priority.filter(id => !camps.includes(id)).slice(0, paladinCount);
      return [player.uid, [...camps, ...paladinBlessings]];
    }));
    const blessingCounts = Object.fromEntries(blessingIds.map(id => [id, players.filter(player => blessingAssignments.get(player.uid).includes(id)).length]));
    const providers = {};
    for (const player of players) for (const buffId of player.provides) {
      if (active(data.buffs[buffId])) (providers[buffId] ||= []).push(player);
    }
    const rawGroupProviders = groups.map(group => {
      const groupPlayers = group.filter(Boolean);
      const partyProviders = {};
      for (const player of groupPlayers) for (const buffId of player.provides) {
        if (data.buffs[buffId]?.scope === 'party' && active(data.buffs[buffId])) (partyProviders[buffId] ||= []).push(player);
      }
      return partyProviders;
    });
    const groupChoiceOptions = groups.map((_, groupIndex) => Object.entries(data.groupChoiceLabels || {}).flatMap(([choiceId, name]) => {
      const effects = Object.keys(rawGroupProviders[groupIndex]).filter(buffId => exclusiveKeys(data.buffs[buffId]).includes(choiceId));
      if (effects.length < 2) return [];
      const selected = effects.includes(requestedGroupChoices[groupIndex][choiceId]) ? requestedGroupChoices[groupIndex][choiceId] : null;
      return [{ id: choiceId, name, effects, selected, options: effects.map(id => ({ id, name: data.buffs[id].name, icon: data.buffs[id].icon })) }];
    }));
    const normalizedGroupChoices = groupChoiceOptions.map(items => Object.fromEntries(items.filter(item => item.selected).map(item => [item.id, item.selected])));
    const automaticGroupChoices = groups.map((_, groupIndex) => Object.fromEntries(Object.entries(data.groupEffectPriority || {}).flatMap(([choiceId, priority]) => {
      const selected = priority.find(buffId => rawGroupProviders[groupIndex][buffId]);
      return selected ? [[choiceId, selected]] : [];
    })));
    const groupCoverage = groups.map((group, groupIndex) => {
      const groupPlayers = group.filter(Boolean);
      return Object.entries(rawGroupProviders[groupIndex]).filter(([buffId]) => exclusiveKeys(data.buffs[buffId]).every(choiceId => {
        const selected = normalizedGroupChoices[groupIndex][choiceId] || automaticGroupChoices[groupIndex][choiceId];
        return !selected || selected === buffId;
      })).map(([buffId, sourcePlayers]) => ({
        buffId, providers: sourcePlayers, recipients: groupPlayers.filter(player => eligible(data.buffs[buffId], player)), groupIndex
      }));
    });
    const groupGaps = groups.map((group, groupIndex) => {
      const groupPlayers = group.filter(Boolean);
      if (!groupPlayers.length) return [];
      return (data.partyRecommendations || []).flatMap(recommendation => {
        const options = recommendation.options || recommendation.effects.map(id => ({ id, helps: recommendation.helps }));
        const relevantOptions = options.filter(option => groupPlayers.some(player => option.helps === 'all' || player.tags.includes(option.helps)));
        const recipients = groupPlayers.filter(player => relevantOptions.some(option => option.helps === 'all' || player.tags.includes(option.helps)));
        if (!recipients.length) return [];
        const effects = relevantOptions.map(option => option.id);
        const classCovered = effects.some(id => groupCoverage[groupIndex].some(item => item.buffId === id));
        const campCovered = recipients.every(player => relevantOptions.some(option => (option.helps === 'all' || player.tags.includes(option.helps)) && assignedCampFor(player, option.id)));
        if (classCovered || campCovered) return [];
        const elsewhereByUid = new Map(effects.flatMap(id => providers[id] || [])
          .filter(player => !groupPlayers.some(member => member.uid === player.uid))
          .map(player => [player.uid, player]));
        const hasPhysical = recipients.some(player => player.tags.includes('physical'));
        const hasSpell = recipients.some(player => player.tags.includes('spell'));
        const iconProfile = hasPhysical && hasSpell ? 'mixed' : (hasPhysical ? 'physical' : 'spell');
        const iconEffect = recommendation.recipientIcon?.[iconProfile] || effects[0];
        return [{ ...recommendation, effects, iconEffect, optionNames: effects.map(id => data.buffs[id].name), recipients, elsewhere: [...elsewhereByUid.values()] }];
      });
    });
    const groupOptionalEffects = groups.map((group, groupIndex) => (data.optionalGroupEffects || []).flatMap(effect => {
      const effectProviders = group.filter(player => player?.classId === effect.classId);
      return effectProviders.length ? [{ ...effect, providers: effectProviders, capacity: effectProviders.length, groupIndex }] : [];
    }));
    const campCoverageSummary = {};
    for (const buffId of Object.keys(data.buffs)) {
      const eligibleRecipients = players.filter(player => eligible(data.buffs[buffId], player));
      const assignments = campCoverage[buffId] || [];
      const recipients = eligibleRecipients.filter(player => assignedCampFor(player, buffId));
      const preferredRecipients = eligibleRecipients.filter(player => assignedCampFor(player, buffId, true));
      campCoverageSummary[buffId] = {
        assignments,
        camps: [...new Map(assignments.map(entry => [entry.camp.id, entry.camp])).values()],
        recipients,
        eligibleRecipients,
        complete: eligibleRecipients.length > 0 && recipients.length === eligibleRecipients.length,
        preferredComplete: eligibleRecipients.length > 0 && preferredRecipients.length === eligibleRecipients.length,
        preferredRecipients
      };
    }
    const playerCoverage = new Map(players.map(player => [player.uid, []]));
    for (const player of players) {
      for (const [buffId, sourcePlayers] of Object.entries(providers)) {
        const buff = data.buffs[buffId];
        if (buff.scope === 'raid' && eligible(buff, player) && !assignedCampFor(player, buffId, true)
          && (!blessingIds.includes(buffId) || blessingAssignments.get(player.uid).includes(buffId))) playerCoverage.get(player.uid).push({ buffId, providers: sourcePlayers });
      }
      const groupIndex = groups.findIndex(group => group.some(item => item?.uid === player.uid));
      for (const item of groupCoverage[groupIndex] || []) {
        if (item.recipients.some(recipient => recipient.uid === player.uid) && !assignedCampFor(player, item.buffId, true)) playerCoverage.get(player.uid).push(item);
      }
    }
    const conflicts = groupCoverage.map(items => {
      const byExclusive = {};
      for (const item of items) {
        for (const key of exclusiveKeys(data.buffs[item.buffId])) (byExclusive[key] ||= []).push(item.buffId);
      }
      return Object.entries(byExclusive).filter(([, ids]) => new Set(ids).size > 1).map(([exclusive, ids]) => ({ exclusive, buffIds: [...new Set(ids)] }));
    });
    groupCoverage.forEach((items, groupIndex) => items.forEach(item => {
      item.conflicted = conflicts[groupIndex].some(entry => entry.buffIds.includes(item.buffId));
    }));
    const globalExclusive = {};
    for (const [buffId, sourcePlayers] of Object.entries(providers)) {
      const buff = data.buffs[buffId];
      if (!sourcePlayers.length || buff.scope === 'party') continue;
      for (const key of exclusiveKeys(buff)) (globalExclusive[key] ||= []).push(buffId);
    }
    const globalConflicts = Object.entries(globalExclusive)
      .filter(([, ids]) => new Set(ids).size > 1)
      .map(([exclusive, ids]) => ({ exclusive, buffIds: [...new Set(ids)] }));

    const assignmentGroups = {};
    for (const [buffId, sourcePlayers] of Object.entries(providers)) {
      const key = data.buffs[buffId].providerExclusive;
      if (key && key !== 'paladin-blessing' && sourcePlayers.length) (assignmentGroups[key] ||= []).push(buffId);
    }
    const requestedBossEffects = new Set();
    for (const recommendation of data.bossRecommendations || []) {
      const relevant = recommendation.always
        || (recommendation.requiresClass && players.some(player => player.classId === recommendation.requiresClass))
        || (recommendation.helps && players.some(player => player.tags.includes(recommendation.helps)));
      if (!relevant) continue;
      const covered = recommendation.effects.filter(id => active(data.buffs[id]) && providers[id]?.length);
      const requested = requestedBossChoices[recommendation.id];
      const selected = covered.includes(requested) ? requested : ((recommendation.preferWhenCovered || []).find(id => covered.includes(id)) || covered[0]);
      if (selected) requestedBossEffects.add(selected);
    }
    const assignmentConflicts = [];
    for (const [exclusive, buffIds] of Object.entries(assignmentGroups)) {
      const scope = data.buffs[buffIds[0]].scope;
      if (scope === 'boss') {
        const requestedBuffIds = buffIds.filter(id => requestedBossEffects.has(id));
        const providerIds = new Set(requestedBuffIds.flatMap(id => providers[id].map(player => player.uid)));
        if (requestedBuffIds.length > providerIds.size) assignmentConflicts.push({ exclusive, buffIds: requestedBuffIds, recipients: ['boss'], providerCount: providerIds.size });
      } else if (scope === 'raid') {
        const recipients = [];
        for (const player of players) {
          const eligibleBuffIds = buffIds.filter(id => eligible(data.buffs[id], player));
          const campCovered = eligibleBuffIds.filter(id => assignedCampFor(player, id, true));
          const applicable = eligibleBuffIds.filter(id => !campCovered.includes(id));
          const providerIds = new Set(applicable.flatMap(id => providers[id].map(source => source.uid)));
          const assignmentTarget = data.providerAssignmentTargets?.[exclusive] ?? Infinity;
          const requiredAssignments = Math.max(0, Math.min(eligibleBuffIds.length, assignmentTarget) - campCovered.length);
          if (requiredAssignments > providerIds.size) recipients.push(player.uid);
        }
        if (recipients.length) assignmentConflicts.push({ exclusive, buffIds, recipients, providerCount: new Set(buffIds.flatMap(id => providers[id].map(player => player.uid))).size });
      }
    }
    for (const [uid, items] of playerCoverage) for (const item of items) {
      item.assignmentConflicted = assignmentConflicts.some(entry => entry.buffIds.includes(item.buffId) && entry.recipients.includes(uid));
    }
    const conflictIds = new Set([...globalConflicts, ...assignmentConflicts].flatMap(entry => entry.buffIds));
    const bossChecklist = (data.bossRecommendations || []).flatMap(recommendation => {
      const effects = recommendation.effects.filter(id => active(data.buffs[id]));
      const relevant = recommendation.always
        || (recommendation.requiresClass && players.some(player => player.classId === recommendation.requiresClass))
        || (recommendation.helps && players.some(player => player.tags.includes(recommendation.helps)));
      if (!relevant || !effects.length) return [];
      const coveredBy = effects.filter(id => providers[id]?.length);
      const providerMap = new Map(coveredBy.flatMap(id => providers[id]).map(player => [player.uid, player]));
      const defaultEffect = recommendation.iconEffect || effects[0];
      const requestedChoice = requestedBossChoices[recommendation.id];
      const displayEffect = coveredBy.includes(requestedChoice) ? requestedChoice : ((recommendation.preferWhenCovered || []).find(id => coveredBy.includes(id)) || coveredBy[0] || defaultEffect);
      const providerList = [...providerMap.values()];
      const displayBuff = data.buffs[displayEffect];
      const availableProviderClasses = [...new Set(providerList.map(player => player.classId))].filter(classId => displayBuff.providerVariants?.[classId]);
      const displayProviderClass = availableProviderClasses.includes(requestedChoice) ? requestedChoice : ((recommendation.providerDisplayPriority || []).find(classId => availableProviderClasses.includes(classId)) || recommendation.defaultProviderClass);
      const displayVariant = displayBuff.providerVariants?.[displayProviderClass];
      const effectChoices = coveredBy.map(id => ({ id, name: data.buffs[id].name, icon: data.buffs[id].icon }));
      const providerChoices = availableProviderClasses.map(classId => ({ id: classId, name: displayBuff.providerVariants[classId].name, icon: displayBuff.providerVariants[classId].icon }));
      return [{ ...recommendation, effects, coveredBy, providers: providerList, iconEffect: defaultEffect, displayEffect, displayName: displayVariant?.name || displayBuff.name, displayIcon: displayVariant?.icon || displayBuff.icon, choiceOptions: effects.length > 1 ? effectChoices : providerChoices, selectedChoice: effects.length > 1 ? displayEffect : displayProviderClass, requestedChoice: requestedChoice || null }];
    });
    const missing = {
      raid: data.recommended.raid.filter(id => active(data.buffs[id]) && !providers[id]?.length && !campCoverageSummary[id].complete),
      boss: bossChecklist.filter(item => !item.coveredBy.length).map(item => item.id)
    };
    return { players, providers, groupCoverage, groupGaps, groupOptionalEffects, groupChoiceOptions, groupChoices: normalizedGroupChoices, selectedCampBuffs, playerCampBuffs, campCoverage, campCoverageSummary, playerCoverage, blessingPriorities, blessingAssignments, blessingCounts, paladinCount, conflicts, globalConflicts, assignmentConflicts, conflictIds, bossChecklist, missing };
  }
  return { analyze, eligible, active };
});
