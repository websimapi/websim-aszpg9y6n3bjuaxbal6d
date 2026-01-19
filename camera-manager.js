import * as THREE from 'three';

export class CameraManager {
    constructor(camera) {
        this.camera = camera;
    }

    update(dt, snakeHeadPos, snakeHeadQuat, earthRadius, snap = false) {
        // Target Distance: Maintain constant height above surface (approx 22 units above base)
        // Adjust for earth growth
        const dist = 32 + (earthRadius - 10); 
        const idealCameraPos = snakeHeadPos.clone().normalize().multiplyScalar(dist);
        
        if (snap) {
            this.camera.position.copy(idealCameraPos);
        } else {
            // Smooth damping for position to filter out high-frequency terrain noise
            // exp(-lambda * dt) provides frame-rate independent damping
            const posFactor = 1.0 - Math.exp(-3.0 * dt);
            this.camera.position.lerp(idealCameraPos, posFactor);
        }

        // Calculate a stable "Up" vector for the camera
        // We project the snake's forward vector onto the sphere's tangent plane.
        // This decouples the camera orientation from the snake's local pitch/roll on rocks.
        const sphereNormal = snakeHeadPos.clone().normalize();
        const snakeForward = new THREE.Vector3(0, 0, 1).applyQuaternion(snakeHeadQuat);
        
        // Remove the component of forward parallel to normal (the "pitch" due to hills)
        const projectedUp = snakeForward.clone().sub(
            sphereNormal.clone().multiplyScalar(snakeForward.dot(sphereNormal))
        ).normalize();

        if (snap) {
            this.camera.up.copy(projectedUp);
        } else {
            // Damping rotation slower than position for stability
            const rotFactor = 1.0 - Math.exp(-2.0 * dt);
            this.camera.up.lerp(projectedUp, rotFactor).normalize();
        }

        this.camera.lookAt(0, 0, 0);
    }
}