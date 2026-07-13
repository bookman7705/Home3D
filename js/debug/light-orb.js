import * as THREE from "three";

/**
 * Emissive orb that follows the selected light's world position.
 * Dims/hides when the light intensity is ~0 so it doesn't fake a bulb glow.
 */
export function createLightDebugOrb({ scene, radius = 0.08, visible = true } = {}) {
  const geom = new THREE.SphereGeometry(Math.max(0.01, radius), 16, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 2,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = "LightDebugOrb";
  mesh.visible = !!visible;
  scene.add(mesh);

  const worldPos = new THREE.Vector3();
  let wantVisible = !!visible;
  const baseEmissive = 2;

  function setVisible(value) {
    wantVisible = !!value;
    if (!wantVisible) mesh.visible = false;
  }

  function setRadius(next) {
    const r = Math.max(0.01, Number(next) || 0.08);
    const s = r / 0.08;
    mesh.scale.setScalar(s);
  }

  function syncToLight(light) {
    if (!wantVisible) {
      mesh.visible = false;
      return;
    }
    if (!light?.isObject3D) {
      mesh.visible = false;
      return;
    }

    const intensity = Number(light.intensity);
    const lit = Number.isFinite(intensity) ? intensity > 1e-4 : true;

    light.getWorldPosition(worldPos);
    mesh.position.copy(worldPos);
    mesh.visible = lit;

    if (!lit) return;

    if (light.color) {
      mat.color.copy(light.color);
      mat.emissive.copy(light.color);
    }
    // Keep orb readable without overpowering scene bloom at high intensities.
    mat.emissiveIntensity = Math.min(baseEmissive, 0.5 + intensity * 0.25);
  }

  function dispose() {
    scene.remove(mesh);
    geom.dispose();
    mat.dispose();
  }

  return { mesh, syncToLight, setVisible, setRadius, dispose };
}
