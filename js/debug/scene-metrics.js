/**
 * Structural scene metrics for the performance stats overlay.
 * Expensive: traverse the graph. Call on GLB load / lightmap apply / every 1–2s while open.
 */
import * as THREE from "three";
import { authoredMaterialKey, authoredMaterialName } from "./gltf-identity.js";

const MATERIAL_TEXTURE_KEYS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "envMap",
];

const _frustum = new THREE.Frustum();
const _proj = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

function meshList(obj) {
  if (!obj) return [];
  return Array.isArray(obj.material) ? obj.material : [obj.material];
}

function triangleCount(geometry) {
  if (!geometry) return 0;
  if (geometry.index) return Math.floor((geometry.index.count || 0) / 3);
  const pos = geometry.getAttribute?.("position");
  return pos ? Math.floor((pos.count || 0) / 3) : 0;
}

function vertexCount(geometry) {
  const pos = geometry?.getAttribute?.("position");
  return pos?.count || 0;
}

function isWorldVisible(obj) {
  let o = obj;
  while (o) {
    if (o.visible === false) return false;
    o = o.parent;
  }
  return true;
}

function isDescendantOf(obj, root) {
  if (!root || !obj) return false;
  let o = obj;
  while (o) {
    if (o === root) return true;
    o = o.parent;
  }
  return false;
}

function roleFromAncestors(obj) {
  let o = obj;
  while (o) {
    const role = o.userData?.statsRole;
    if (role) return role;
    if (o.isArrowHelper || o.isBoxHelper || o.isSkeletonHelper) return "debug";
    o = o.parent;
  }
  return null;
}

function classifyMesh(mesh, gltfRoot) {
  const tagged = roleFromAncestors(mesh);
  if (tagged === "physics") return "physics";
  if (tagged === "debug") return "debug";
  if (mesh.userData?.gltfMeshIndex != null) return "imported";
  if (gltfRoot && isDescendantOf(mesh, gltfRoot)) return "imported";
  if (mesh.name === "LightDebugOrb") return "debug";
  return "runtime";
}

function textureSize(tex) {
  if (!tex) return null;
  const img = tex.image || tex.source?.data;
  if (!img) return null;
  if (img.width && img.height) return { w: img.width, h: img.height };
  if (Array.isArray(img) && img[0]?.width) {
    return { w: img[0].width, h: img[0].height, faces: img.length };
  }
  return null;
}

function bytesPerPixel(tex) {
  if (!tex) return 4;
  if (tex.type === THREE.FloatType) return 16;
  if (tex.type === THREE.HalfFloatType) return 8;
  return 4;
}

function estimateTextureBytes(tex) {
  const size = textureSize(tex);
  if (!size) return 0;
  const faces = tex.isCubeTexture ? 6 : size.faces || 1;
  let bytes = size.w * size.h * bytesPerPixel(tex) * faces;
  if (tex.generateMipmaps) bytes = Math.ceil(bytes * (4 / 3));
  return bytes;
}

function collectMaterialTextures(mat, into) {
  if (!mat) return;
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const tex = mat[key];
    if (tex?.isTexture) into.add(tex);
  }
  if (mat.lightMap?.isTexture) into.add(mat.lightMap);
}

function inFrustumEstimate(mesh, camera) {
  if (!camera || !mesh.geometry) return true;
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const bs = mesh.geometry.boundingSphere;
  if (!bs) return true;
  _sphere.copy(bs);
  _sphere.applyMatrix4(mesh.matrixWorld);
  return _frustum.intersectsSphere(_sphere);
}

function rtBytes(rt) {
  if (!rt) return 0;
  const w = rt.width || 0;
  const h = rt.height || 0;
  if (!w || !h) return 0;
  return estimateTextureBytes(rt.texture) || w * h * bytesPerPixel(rt.texture);
}

/**
 * @param {{
 *   scene: import("three").Scene,
 *   camera?: import("three").Camera,
 *   renderer?: import("three").WebGLRenderer,
 *   gltfRoot?: import("three").Object3D | null,
 *   gltfMeta?: { authoredMaterials: number, gltfMeshes: number, gltfPrimitives: number, materialDefs?: {index:number,name:string}[] } | null,
 *   postFx?: { composer?: any, bloomPass?: any, getPostFxInfo?: Function } | null,
 *   lightmapInfo?: { atlasCount?: number, lightMapTextures?: import("three").Texture[] } | null,
 * }} opts
 */
export function collectStructuralStats({
  scene,
  camera = null,
  renderer = null,
  gltfRoot = null,
  gltfMeta = null,
  postFx = null,
  lightmapInfo = null,
} = {}) {
  const instanceIds = new Set();
  const geometryIds = new Set();
  const authored = new Map();
  const materialTextures = new Set();
  const lightmapTextures = new Set();

  let threeMeshes = 0;
  let imported = 0;
  let debugMeshes = 0;
  let physicsMeshes = 0;
  let runtimeMeshes = 0;
  let graphVisible = 0;
  let frustumCulledDisabled = 0;
  let inFrustum = 0;
  let geomTris = 0;
  let visibleGeomTris = 0;
  let geomVerts = 0;
  let lights = 0;
  let bones = 0;
  const lightmapCloneIds = new Set();
  let lines = 0;

  if (camera) {
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_proj);
  }

  function ensureAuthored(mat) {
    const key = authoredMaterialKey(mat);
    let row = authored.get(key);
    if (!row) {
      const index =
        mat.userData?.gltfMaterialIndex != null
          ? Number(mat.userData.gltfMaterialIndex)
          : null;
      row = {
        key,
        name: authoredMaterialName(mat, index),
        gltfIndex: index,
        primitives: 0,
        meshes: 0,
        instanceIds: new Set(),
        lightmapIds: new Set(),
        textureIds: new Set(),
        lightmapCloned: 0,
      };
      authored.set(key, row);
    }
    return row;
  }

  scene?.traverse((obj) => {
    if (obj.isLight) lights += 1;
    if (obj.isBone) bones += 1;
    if (obj.isLine || obj.isLineSegments) {
      lines += 1;
      return;
    }

    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    threeMeshes += 1;
    const kind = classifyMesh(obj, gltfRoot);
    if (kind === "imported") imported += 1;
    else if (kind === "physics") physicsMeshes += 1;
    else if (kind === "debug") debugMeshes += 1;
    else runtimeMeshes += 1;

    const worldVis = isWorldVisible(obj);
    if (worldVis) graphVisible += 1;
    if (obj.frustumCulled === false) frustumCulledDisabled += 1;

    if (obj.geometry) {
      geometryIds.add(obj.geometry.uuid);
      const tris = triangleCount(obj.geometry);
      const verts = vertexCount(obj.geometry);
      geomTris += tris;
      geomVerts += verts;
      if (worldVis) visibleGeomTris += tris;
    }

    if (worldVis && camera) {
      if (obj.frustumCulled === false || inFrustumEstimate(obj, camera)) {
        inFrustum += 1;
      }
    } else if (worldVis && !camera) {
      inFrustum += 1;
    }

    const mats = meshList(obj);
    const seenKeysThisMesh = new Set();
    for (const mat of mats) {
      if (!mat) continue;
      instanceIds.add(mat.uuid);
      if (mat.userData?.lightmapClone) lightmapCloneIds.add(mat.uuid);
      collectMaterialTextures(mat, materialTextures);
      if (mat.lightMap?.isTexture) lightmapTextures.add(mat.lightMap);

      const row = ensureAuthored(mat);
      row.instanceIds.add(mat.uuid);
      row.primitives += 1;
      if (!seenKeysThisMesh.has(row.key)) {
        row.meshes += 1;
        seenKeysThisMesh.add(row.key);
      }
      if (mat.userData?.lightmapClone) row.lightmapCloned += 1;
      if (mat.lightMap?.isTexture) row.lightmapIds.add(mat.lightMap.uuid);
      else row.lightmapIds.add("none");
      for (const key of MATERIAL_TEXTURE_KEYS) {
        if (mat[key]?.isTexture) row.textureIds.add(mat[key].uuid);
      }
      if (mat.lightMap?.isTexture) row.textureIds.add(mat.lightMap.uuid);
    }
  });

  if (gltfMeta?.materialDefs) {
    for (const def of gltfMeta.materialDefs) {
      const key = `idx:${def.index}`;
      if (!authored.has(key)) {
        authored.set(key, {
          key,
          name: def.name,
          gltfIndex: def.index,
          primitives: 0,
          meshes: 0,
          instanceIds: new Set(),
          lightmapIds: new Set(),
          textureIds: new Set(),
          lightmapCloned: 0,
        });
      }
    }
  }

  const packMaps = lightmapInfo?.lightMapTextures || [];
  for (const tex of packMaps) {
    if (tex?.isTexture) lightmapTextures.add(tex);
  }

  for (const tex of lightmapTextures) materialTextures.delete(tex);

  const postFxInfo = typeof postFx?.getPostFxInfo === "function" ? postFx.getPostFxInfo() : null;
  const postFxTextures = new Set();
  let postFxBytes = 0;
  const composer = postFx?.composer;
  if (composer) {
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (rt?.texture) {
        postFxTextures.add(rt.texture);
        postFxBytes += rtBytes(rt);
      }
    }
  }
  const bloom = postFx?.bloomPass;
  if (bloom) {
    const rts = [
      bloom.renderTargetBright,
      ...(bloom.renderTargetsHorizontal || []),
      ...(bloom.renderTargetsVertical || []),
    ];
    for (const rt of rts) {
      if (rt?.texture) {
        postFxTextures.add(rt.texture);
        postFxBytes += rtBytes(rt);
      }
    }
  }

  let matBytes = 0;
  let largest = { w: 0, h: 0, label: "n/a" };
  for (const tex of [...materialTextures, ...lightmapTextures]) {
    matBytes += estimateTextureBytes(tex);
    const size = textureSize(tex);
    if (size && size.w * size.h > largest.w * largest.h) {
      largest = {
        w: size.w,
        h: size.h,
        label: `${size.w} × ${size.h}`,
      };
    }
  }

  const estimatedBytes = matBytes + postFxBytes;
  const authoredRows = [...authored.values()]
    .map((row) => ({
      name: row.name,
      gltfIndex: row.gltfIndex,
      primitives: row.primitives,
      meshes: row.meshes,
      instances: row.instanceIds.size,
      lightmapVariants: [...row.lightmapIds].filter((id) => id !== "none").length,
      textures: row.textureIds.size,
      lightmapCloned: row.lightmapCloned,
    }))
    .sort((a, b) => b.primitives - a.primitives || String(a.name).localeCompare(b.name));

  const authoredCount =
    gltfMeta?.authoredMaterials != null
      ? gltfMeta.authoredMaterials
      : authoredRows.filter((r) => r.gltfIndex != null).length || authoredRows.length;

  const programs = Array.isArray(renderer?.info?.programs)
    ? renderer.info.programs.length
    : 0;

  return {
    gltfMeshes: gltfMeta?.gltfMeshes ?? null,
    gltfPrimitives: gltfMeta?.gltfPrimitives ?? null,
    threeMeshes,
    importedMeshes: imported,
    debugHelperMeshes: debugMeshes,
    physicsMeshes,
    runtimeMeshes,
    lineObjects: lines,
    graphVisibleMeshes: graphVisible,
    frustumCulledDisabled,
    inFrustumEstimate: inFrustum,
    frustumCulledEstimate: Math.max(0, graphVisible - inFrustum),
    geometryObjects: geometryIds.size,
    geometryTriangles: geomTris,
    visibleGeometryTriangles: visibleGeomTris,
    geometryVertices: geomVerts,
    lights,
    bones,
    authoredMaterials: authoredCount,
    materialInstances: instanceIds.size,
    lightmapClonedMaterials: lightmapCloneIds.size,
    authoredRows,
    textures: {
      material: materialTextures.size,
      lightmap: lightmapTextures.size,
      postFx: postFxTextures.size,
      estimatedBytes,
      largest,
    },
    programs,
    programReuse:
      programs > 0 && instanceIds.size > programs
        ? `${instanceIds.size} instances / ${programs} programs`
        : programs > 0
          ? "1:1 or fewer instances than programs"
          : "n/a",
    lightmapAtlases: Number(lightmapInfo?.atlasCount) || lightmapTextures.size || 0,
    postFx: postFxInfo,
  };
}
