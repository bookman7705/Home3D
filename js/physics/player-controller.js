import * as THREE from "three";

const DEG = Math.PI / 180;

/** Capsule character defaults (scaled by worldScale at create time). */
export const PLAYER_DEFAULTS = {
  radius: 0.4,
  halfHeight: 0.5, // cylindrical half-height; total = 2*(halfHeight+radius) = 1.8
  eyeHeight: 1.71, // world Y from feet (matches prior camera height lock)
  moveSpeed: 2.7,
  jumpSpeed: 7.0,
  /** Jump input + impulse are wired; keep false until jump is enabled. */
  enableJump: false,
  gravity: -20.0,
  maxSlopeClimbDeg: 45,
  minSlopeSlideDeg: 50,
  controllerOffset: 0.01,
  autostepMaxHeight: 0.35,
  autostepMinWidth: 0.2,
  snapToGroundDistance: 0.15,
  minLandingDownSpeed: 0.5,
  groundCoyoteTime: 0.12,
  jumpLandLockTime: 0.1,
};

function totalCapsuleHeight(player) {
  return 2 * (player.halfHeight + player.radius);
}

/**
 * First-person kinematic character controller backed by Rapier.
 * Uses the app camera for look; movement comes from external move flags
 * (PC WASD / mobile on-screen controls).
 */
export function createPhysicsPlayer({
  RAPIER,
  world,
  scene,
  camera,
  spawn = { x: 0, y: 0, z: 0 },
  worldScale = 1,
  config = {},
}) {
  const S = Math.max(0.0001, Number(worldScale) || 1);
  const PLAYER = {
    ...PLAYER_DEFAULTS,
    ...config,
    radius: (config.radius ?? PLAYER_DEFAULTS.radius) * S,
    halfHeight: (config.halfHeight ?? PLAYER_DEFAULTS.halfHeight) * S,
    eyeHeight: (config.eyeHeight ?? PLAYER_DEFAULTS.eyeHeight) * S,
    moveSpeed: (config.moveSpeed ?? PLAYER_DEFAULTS.moveSpeed) * S,
    jumpSpeed: (config.jumpSpeed ?? PLAYER_DEFAULTS.jumpSpeed) * S,
    gravity: config.gravity ?? PLAYER_DEFAULTS.gravity,
    enableJump: config.enableJump ?? PLAYER_DEFAULTS.enableJump,
    autostepMaxHeight:
      (config.autostepMaxHeight ?? PLAYER_DEFAULTS.autostepMaxHeight) * S,
    autostepMinWidth:
      (config.autostepMinWidth ?? PLAYER_DEFAULTS.autostepMinWidth) * S,
    snapToGroundDistance:
      (config.snapToGroundDistance ?? PLAYER_DEFAULTS.snapToGroundDistance) * S,
    controllerOffset:
      (config.controllerOffset ?? PLAYER_DEFAULTS.controllerOffset) * S,
  };

  const capsuleHeight = totalCapsuleHeight(PLAYER);
  const bodyY = spawn.y + capsuleHeight * 0.5;
  const minFloorNormalY = Math.cos(PLAYER.maxSlopeClimbDeg * DEG);

  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(spawn.x, bodyY, spawn.z)
    .lockRotations();
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius)
    .setActiveCollisionTypes(
      RAPIER.ActiveCollisionTypes.DEFAULT |
        RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED
    );
  const collider = world.createCollider(colliderDesc, body);

  const controller = world.createCharacterController(PLAYER.controllerOffset);
  controller.setSlideEnabled(true);
  controller.setApplyImpulsesToDynamicBodies(false);
  controller.setMaxSlopeClimbAngle(PLAYER.maxSlopeClimbDeg * DEG);
  controller.setMinSlopeSlideAngle(PLAYER.minSlopeSlideDeg * DEG);
  controller.enableAutostep(PLAYER.autostepMaxHeight, PLAYER.autostepMinWidth, false);
  controller.enableSnapToGround(PLAYER.snapToGroundDistance);
  controller.setUp({ x: 0, y: 1, z: 0 });

  let verticalVelocity = 0;
  let grounded = false;
  let snapEnabled = true;
  let surfaceNormal = new THREE.Vector3(0, 1, 0);
  let slopeAngleDeg = 0;
  let jumpQueued = false;
  let ungroundedTime = 0;
  let timeSinceJump = PLAYER.jumpLandLockTime;

  const forwardVec = new THREE.Vector3();
  const rightVec = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);

  const capsuleGeo = new THREE.CapsuleGeometry(
    PLAYER.radius,
    PLAYER.halfHeight * 2,
    4,
    12
  );
  const capsuleMat = new THREE.MeshBasicMaterial({
    color: 0x4cff9a,
    wireframe: true,
    depthTest: true,
  });
  const capsuleDebug = new THREE.Mesh(capsuleGeo, capsuleMat);
  capsuleDebug.visible = false;
  scene.add(capsuleDebug);

  const normalArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(),
    1.2 * S,
    0xffaa00,
    0.2 * S,
    0.12 * S
  );
  normalArrow.visible = false;
  scene.add(normalArrow);

  function setSnapEnabled(enabled) {
    if (enabled === snapEnabled) return;
    snapEnabled = enabled;
    if (enabled) {
      controller.enableSnapToGround(PLAYER.snapToGroundDistance);
    } else {
      controller.disableSnapToGround();
    }
  }

  /** Queue a jump (no-op while enableJump is false). */
  function queueJump() {
    if (!PLAYER.enableJump) return;
    jumpQueued = true;
  }

  function syncCameraToBody() {
    const pos = body.translation();
    const eyeY = pos.y - capsuleHeight * 0.5 + PLAYER.eyeHeight;
    camera.position.set(pos.x, eyeY, pos.z);
    capsuleDebug.position.set(pos.x, pos.y, pos.z);
  }

  // Place camera at spawn eye height immediately.
  syncCameraToBody();

  /**
   * @param {number} dt
   * @param {{ forward?: boolean, back?: boolean, left?: boolean, right?: boolean }} move
   */
  function update(dt, move = {}) {
    camera.getWorldDirection(forwardVec);
    forwardVec.y = 0;
    if (forwardVec.lengthSq() < 1e-8) {
      forwardVec.set(0, 0, -1);
    } else {
      forwardVec.normalize();
    }
    rightVec.crossVectors(forwardVec, upAxis).normalize();

    const wish = new THREE.Vector3();
    if (move.forward) wish.add(forwardVec);
    if (move.back) wish.addScaledVector(forwardVec, -1);
    if (move.right) wish.add(rightVec);
    if (move.left) wish.addScaledVector(rightVec, -1);

    if (wish.lengthSq() > 0) {
      wish.normalize().multiplyScalar(PLAYER.moveSpeed);
    }

    timeSinceJump += dt;
    verticalVelocity += PLAYER.gravity * dt;

    let jumpedThisFrame = false;
    if (PLAYER.enableJump && grounded && jumpQueued) {
      verticalVelocity = PLAYER.jumpSpeed;
      grounded = false;
      jumpedThisFrame = true;
      timeSinceJump = 0;
      setSnapEnabled(false);
    }
    jumpQueued = false;

    const desired = {
      x: wish.x * dt,
      y: verticalVelocity * dt,
      z: wish.z * dt,
    };

    controller.computeColliderMovement(
      collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
    );
    const movement = controller.computedMovement();

    surfaceNormal.set(0, 1, 0);
    slopeAngleDeg = 0;
    let bestFloorDot = -1;
    let hasWalkableFloor = false;
    const collisionCount = controller.numComputedCollisions();

    for (let i = 0; i < collisionCount; i++) {
      const col = controller.computedCollision(i);
      if (!col || !col.normal1) continue;

      const n = col.normal1;
      const nLen = Math.hypot(n.x, n.y, n.z) || 1;
      const normalY = n.y / nLen;

      if (normalY > bestFloorDot) {
        bestFloorDot = normalY;
        surfaceNormal.set(n.x / nLen, normalY, n.z / nLen);
        slopeAngleDeg =
          (Math.acos(Math.min(1, Math.max(-1, normalY))) * 180) / Math.PI;
      }

      if (normalY > minFloorNormalY) {
        hasWalkableFloor = true;
      }
    }

    const rapierGrounded = controller.computedGrounded();

    if (jumpedThisFrame) {
      grounded = false;
    } else if (snapEnabled) {
      const supported = rapierGrounded || hasWalkableFloor;

      if (supported) {
        grounded = true;
        ungroundedTime = 0;
        if (verticalVelocity < 0) {
          verticalVelocity = 0;
        }
      } else {
        ungroundedTime += dt;
        if (ungroundedTime > PLAYER.groundCoyoteTime) {
          grounded = false;
          setSnapEnabled(false);
        } else {
          grounded = true;
        }
      }
    } else {
      const hardLand = verticalVelocity < -PLAYER.minLandingDownSpeed;
      const softLand =
        verticalVelocity <= 0 && timeSinceJump >= PLAYER.jumpLandLockTime;
      grounded = (hardLand || softLand) && rapierGrounded && hasWalkableFloor;
      if (grounded) {
        verticalVelocity = 0;
        ungroundedTime = 0;
        setSnapEnabled(true);
      }
    }

    const pos = body.translation();
    const nextX = pos.x + movement.x;
    const nextY = pos.y + movement.y;
    const nextZ = pos.z + movement.z;

    body.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ });
    body.setTranslation({ x: nextX, y: nextY, z: nextZ }, true);

    const eyeY = nextY - capsuleHeight * 0.5 + PLAYER.eyeHeight;
    camera.position.set(nextX, eyeY, nextZ);

    capsuleDebug.position.set(nextX, nextY, nextZ);
    const feet = new THREE.Vector3(nextX, nextY - capsuleHeight * 0.5, nextZ);
    normalArrow.position.copy(feet);
    normalArrow.setDirection(surfaceNormal.clone());

    return {
      grounded,
      surfaceNormal: surfaceNormal.clone(),
      slopeAngleDeg,
      position: new THREE.Vector3(nextX, nextY, nextZ),
      verticalVelocity,
      collisionCount,
    };
  }

  function setDebugVisible(visible) {
    capsuleDebug.visible = visible;
    normalArrow.visible = visible;
  }

  function dispose() {
    scene.remove(capsuleDebug);
    scene.remove(normalArrow);
    capsuleGeo.dispose();
    capsuleMat.dispose();
    if (body) world.removeRigidBody(body);
  }

  return {
    body,
    collider,
    controller,
    PLAYER,
    update,
    queueJump,
    syncCameraToBody,
    setDebugVisible,
    dispose,
    get grounded() {
      return grounded;
    },
    get verticalVelocity() {
      return verticalVelocity;
    },
    get surfaceNormal() {
      return surfaceNormal.clone();
    },
    get slopeAngleDeg() {
      return slopeAngleDeg;
    },
  };
}
