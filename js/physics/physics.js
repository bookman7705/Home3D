import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Initializes Rapier and creates the physics world.
 */
export async function createPhysics() {
  await RAPIER.init();

  const gravity = { x: 0, y: -9.81, z: 0 };
  const world = new RAPIER.World(gravity);

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
