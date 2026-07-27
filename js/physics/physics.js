import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Initializes Rapier and creates the physics world.
 * @param {{ x?: number, y?: number, z?: number }} [gravity]
 */
export async function createPhysics(gravity = { x: 0, y: -9.81, z: 0 }) {
  await RAPIER.init();

  const world = new RAPIER.World({
    x: gravity.x ?? 0,
    y: gravity.y ?? -9.81,
    z: gravity.z ?? 0,
  });

  return { RAPIER, world };
}

/**
 * Creates a fixed rigid body with a collider and returns both.
 */
export function createStaticCollider(RAPIER, world, colliderDesc, translation, rotation = null) {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
    translation.x,
    translation.y,
    translation.z
  );

  if (rotation) {
    bodyDesc.setRotation(rotation);
  }

  const body = world.createRigidBody(bodyDesc);
  const collider = world.createCollider(colliderDesc, body);
  return { body, collider };
}

/**
 * Advances the physics simulation by one fixed timestep.
 */
export function stepPhysics(world) {
  world.step();
}
