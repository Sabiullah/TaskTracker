interface MinimalProfile {
  id: string;
  full_name: string;
  manager_ids: readonly string[] | null;
}

export function actualManagers<P extends MinimalProfile>(
  profiles: readonly P[],
): P[] {
  const ids = new Set<string>();
  for (const p of profiles) {
    for (const id of p.manager_ids ?? []) ids.add(id);
  }
  return profiles.filter((p) => ids.has(p.id));
}

export function subTreeNames<P extends MinimalProfile>(
  rootId: string,
  profiles: readonly P[],
): Set<string> {
  const ids = subTreeIdSet(rootId, profiles);
  if (ids.size === 0) return new Set();
  const names = new Set<string>();
  for (const p of profiles) {
    if (ids.has(p.id) && p.full_name) names.add(p.full_name);
  }
  return names;
}

export function subTreeManagers<P extends MinimalProfile>(
  rootId: string,
  profiles: readonly P[],
): P[] {
  const managerIds = new Set(actualManagers(profiles).map((p) => p.id));
  const subTreeIds = subTreeIdSet(rootId, profiles);
  subTreeIds.delete(rootId);
  return profiles.filter((p) => subTreeIds.has(p.id) && managerIds.has(p.id));
}

function subTreeIdSet<P extends MinimalProfile>(
  rootId: string,
  profiles: readonly P[],
): Set<string> {
  const rootExists = profiles.some((p) => p.id === rootId);
  if (!rootExists) return new Set();
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of profiles) {
      if (visited.has(p.id)) continue;
      if ((p.manager_ids ?? []).includes(cur)) {
        visited.add(p.id);
        queue.push(p.id);
      }
    }
  }
  return visited;
}
