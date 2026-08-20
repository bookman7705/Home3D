import { LOD_NAME_RE } from "./constants.js";

export function parseLodName(name) {
  const n = String(name ?? "").trim();
  const m = n.match(LOD_NAME_RE);
  if (!m || !m[1]) return null;
  return { base: m[1], level: Number(m[2]) };
}

function ignoredName(name, prefixes) {
  const n = String(name ?? "");
  return (prefixes || []).some((p) => p && n.startsWith(p));
}

function ancestorOwnsSameLod(obj, root, base, level) {
  let cur = obj.parent;
  while (cur && cur !== root) {
    const parsed = parseLodName(cur.name);
    if (parsed && parsed.base === base && parsed.level === level) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * Collect `_LODX` nodes under root. If both a parent and a child share the
 * same base+level (Blender object + mesh), only the parent is kept so the
 * whole subtree toggles together.
 */
export function collectLodNodes(root, ignoreNamePrefixes = []) {
  const nodes = [];
  if (!root) return nodes;
  root.traverse((obj) => {
    if (!obj || obj === root) return;
    const parsed = parseLodName(obj.name);
    if (!parsed) return;
    if (ignoredName(obj.name, ignoreNamePrefixes)) return;
    if (ancestorOwnsSameLod(obj, root, parsed.base, parsed.level)) return;
    nodes.push({ object: obj, base: parsed.base, level: parsed.level });
  });
  return nodes;
}

export function groupLodNodes(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    let group = groups.get(node.base);
    if (!group) {
      group = { base: node.base, levels: new Map() };
      groups.set(node.base, group);
    }
    const prev = group.levels.get(node.level);
    if (prev && prev !== node.object) {
      console.warn(
        `[LOD] Duplicate ${node.base}_LOD${node.level} — keeping first node`
      );
      continue;
    }
    group.levels.set(node.level, node.object);
  }
  return groups;
}
