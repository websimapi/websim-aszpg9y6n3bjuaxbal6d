import * as THREE from 'three';
import { getTangentDirection } from './math-utils.js';

export class Snake {
    constructor(scene, earthRadius) {
        this.scene = scene;
        this.EARTH_RADIUS = earthRadius;
        
        // Constants
        this.SPEED = 8.0;
        this.TURN_SPEED = 6.0;
        this.SEGMENT_DISTANCE = 0.8;
        this.STARTING_SEGMENTS = 5;
        
        // State
        this.head = null;
        this.segments = [];
        this.pathHistory = [];
        this.currentDir = new THREE.Vector3(1, 0, 0);

        // Cute face state
        this.tongue = null;
        this.tongueTimer = 0;
        this.timeSinceLastRandomTongue = 0;
        
        this.init();
    }
    
    init() {
        const headGeo = new THREE.BoxGeometry(0.8, 0.4, 0.8);
        const headMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x004400 });
        this.head = new THREE.Mesh(headGeo, headMat);
        this.scene.add(this.head);

        // --- Add cute eyes ---
        // Bigger eyes for cuteness
        const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const eyeWhiteMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, 
            emissive: 0x222222, 
            emissiveIntensity: 0.2,
            roughness: 0.2,
            metalness: 0.0 
        });
        const pupilGeo = new THREE.SphereGeometry(0.06, 12, 12);
        const pupilMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.0 });
        
        // Highlights for eyes
        const highlightGeo = new THREE.SphereGeometry(0.025, 8, 8);
        const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

        // Left eye (from snake's POV, on +X side)
        const leftEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
        leftEye.position.set(0.22, 0.15, 0.25); // moved out and up
        
        const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
        leftPupil.position.set(0.05, 0.02, 0.09);
        leftEye.add(leftPupil);

        const leftHighlight = new THREE.Mesh(highlightGeo, highlightMat);
        leftHighlight.position.set(0.02, 0.03, 0.05);
        leftPupil.add(leftHighlight);

        // Right eye (-X side)
        const rightEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
        rightEye.position.set(-0.22, 0.15, 0.25);
        
        const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
        rightPupil.position.set(-0.05, 0.02, 0.09);
        rightEye.add(rightPupil);

        const rightHighlight = new THREE.Mesh(highlightGeo, highlightMat);
        rightHighlight.position.set(-0.02, 0.03, 0.05);
        rightPupil.add(rightHighlight);

        this.head.add(leftEye);
        this.head.add(rightEye);

        // --- Add tongue (thin box that can extend/retract) ---
        // Longer base geometry
        const tongueGeo = new THREE.BoxGeometry(0.08, 0.02, 0.6);
        const tongueMat = new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0x660011, emissiveIntensity: 0.5 });
        this.tongue = new THREE.Mesh(tongueGeo, tongueMat);
        this.tongue.position.set(0, -0.1, 0.4); // lower position
        // Start fully retracted
        this.tongue.scale.set(1, 1, 0.01);
        this.head.add(this.tongue);
    }

    reset() {
        // Clear segments
        this.segments.forEach(seg => this.scene.remove(seg));
        this.segments = [];
        this.pathHistory = [];
        
        // Reset Head
        this.head.position.set(0, this.EARTH_RADIUS, 0);
        this.head.lookAt(new THREE.Vector3(1, this.EARTH_RADIUS, 0));
        this.head.quaternion.identity(); 
        
        this.currentDir.set(1, 0, 0);
        
        // Rebuild initial body
        for(let i=0; i<this.STARTING_SEGMENTS; i++) {
            this.addSegment();
        }
        
        // Pre-fill history
        const startPos = this.head.position.clone();
        for(let i=0; i<100; i++) {
            this.pathHistory.push({
                pos: startPos.clone(),
                quat: this.head.quaternion.clone()
            });
        }
    }

    addSegment() {
        const segGeo = new THREE.BoxGeometry(0.6, 0.3, 0.6);
        const color = this.getSegmentColor(this.segments.length);
        const segMat = new THREE.MeshStandardMaterial({ color: color });
        const segment = new THREE.Mesh(segGeo, segMat);
        this.scene.add(segment);
        this.segments.push(segment);
    }

    // Generate a gradient of segment colors starting from green
    getSegmentColor(index) {
        // Start at Green (approx 0.33) and shift slowly
        const startHue = 0.33;
        const shiftRate = 0.02; // How fast color changes per segment
        const hue = (startHue + (index * shiftRate)) % 1.0;

        // Keep saturation high
        const sat = 0.85; 
        const light = 0.5;

        const color = new THREE.Color();
        color.setHSL(hue, sat, light);
        return color;
    }

    triggerTongue() {
        // Called when eating to ensure a visible slither
        this.tongueTimer = 0.35; // seconds
    }

    updateTongue(dt) {
        if (!this.tongue) return;

        // Random flicks while moving, even when not eating
        this.timeSinceLastRandomTongue += dt;
        if (this.tongueTimer <= 0 && this.timeSinceLastRandomTongue > 1.0) {
            if (Math.random() < 0.02) { // small chance each frame
                this.tongueTimer = 0.2;
            }
            if (this.tongueTimer > 0) {
                this.timeSinceLastRandomTongue = 0;
            }
        }

        if (this.tongueTimer > 0) {
            this.tongueTimer -= dt;
            const t = Math.max(this.tongueTimer, 0);
            // Normalize into [0,1]
            const span = 0.35;
            const phase = 1.0 - THREE.MathUtils.clamp(t / span, 0, 1);
            
            // Simple extend and retract curve (0 -> 1 -> 0)
            const extend = Math.sin(phase * Math.PI); 
            
            // Base geo is 0.6 long. Scale up for reach.
            const lengthScale = 0.1 + extend * 1.5; 
            this.tongue.scale.z = lengthScale;
            
            // Narrow slightly as it extends
            this.tongue.scale.x = 1.0 - (extend * 0.2);
        } else {
            // Stow tongue
            this.tongue.scale.z = THREE.MathUtils.lerp(this.tongue.scale.z, 0.01, 10 * dt);
            this.tongue.scale.x = THREE.MathUtils.lerp(this.tongue.scale.x, 1.0, 10 * dt);
        }
    }
    
    getTailPosition() {
        return this.segments.length > 0 ? 
               this.segments[this.segments.length - 1].position.clone() : 
               this.head.position.clone();
    }

    update(dt, targetPoint, surfaceInfoFn) {
        // 0. Get Surface Info for Physics
        // We need to know where the "ground" is at current pos
        const info = surfaceInfoFn(this.head.position);
        
        // Physics Loop:
        // The snake moves along the surface.
        // The surface is defined by radius = EARTH_RADIUS + info.height
        // The normal is info.normal.
        
        // Snap head to correct height
        // Add 0.2 offset so the box (height 0.4) sits ON TOP of the terrain, not inside it
        this.head.position.setLength(this.EARTH_RADIUS + info.height + 0.2);

        // 1. Parallel Transport Movement Logic
        const headPos = this.head.position.clone();
        const surfaceNormal = info.normal; // Use the terrain normal!
        
        let currentForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.head.quaternion);
        // Project forward vector onto the terrain tangent plane
        currentForward.projectOnPlane(surfaceNormal).normalize();

        // Steering
        // Use surface distance for steering logic
        if (targetPoint) {
            // Re-normalize target point to current radius for calculation
            const targetAdj = targetPoint.clone().setLength(this.EARTH_RADIUS + info.height);
            
            const dist = headPos.distanceTo(targetAdj);
            if (dist >= 1.0) {
                // Determine direction to target
                // For a sphere, this is complex if we factor in terrain.
                // Simple approx: Direction in global 3D space, projected onto current normal plane.
                const toTarget = new THREE.Vector3().subVectors(targetAdj, headPos).normalize();
                const desiredTangent = toTarget.projectOnPlane(surfaceNormal).normalize();
                
                currentForward.lerp(desiredTangent, this.TURN_SPEED * dt).normalize();
            }
        }
        
        // Orient head to surface
        const lookTarget = currentForward.clone().add(headPos);
        const m = new THREE.Matrix4().lookAt(lookTarget, headPos, surfaceNormal);
        this.head.quaternion.setFromRotationMatrix(m);

        // 2. Move Head Forward
        const moveDist = this.SPEED * dt;
        // On a sphere + height field, moving by arc length
        // Approx: just move vector forward
        const velocity = currentForward.clone().multiplyScalar(moveDist);
        this.head.position.add(velocity);
        
        // Snap to sphere/terrain constraint (explicit integration)
        // We get the NEW normal and height at the NEW position
        // This effectively handles the "Move" step on curved surface
        // But since we just moved linearly in 3D, we drifted off surface.
        // Re-snap:
        // NOTE: We don't have access to next frame's info here easily without callback.
        // But `info` was for the START of the frame.
        // We can re-call `surfaceInfoFn` if we pass the new position?
        // Let's assume the passed function is static context.
        
        if (surfaceInfoFn) {
            const newInfo = surfaceInfoFn(this.head.position);
            this.head.position.setLength(this.EARTH_RADIUS + newInfo.height + 0.2);
            
            // Re-orient to new normal to be safe for next frame?
            // Will be handled at start of next frame.
        }

        // 3. Record History (Surface Position)
        if (this.pathHistory.length === 0 || 
            this.pathHistory[0].pos.distanceTo(this.head.position) > 0.1) {
            
            this.pathHistory.unshift({
                pos: this.head.position.clone(),
                quat: this.head.quaternion.clone()
            });
            
            const maxHistory = (this.segments.length + 2) * (this.SEGMENT_DISTANCE * 10);
            if(this.pathHistory.length > maxHistory) {
                this.pathHistory.length = Math.floor(maxHistory);
            }
        }

        // 4. Update Segments (To Surface Positions)
        this.updateSegments();

        // 5. Update Segments Height
        // Segments follow path history which has position.
        // But we re-sample height to conform to current terrain (e.g. rising island)
        if (surfaceInfoFn) {
            for(const seg of this.segments) {
                const segInfo = surfaceInfoFn(seg.position);
                // Segments are height 0.3, so offset 0.15 to sit on top
                seg.position.setLength(this.EARTH_RADIUS + segInfo.height + 0.15);
                
                // Also tilt segment to match normal?
                // Visual polish: blend stored quat with new normal
                const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(seg.quaternion);
                const targetUp = segInfo.normal;
                const qAlign = new THREE.Quaternion().setFromUnitVectors(currentUp, targetUp);
                seg.quaternion.premultiply(qAlign);
            }
        }

        // 6. Update cute tongue animation
        this.updateTongue(dt);

        return moveDist;
    }



    updateSegments() {
        let distanceAccumulator = 0;
        let historyIndex = 0;
        
        for (let i = 0; i < this.segments.length; i++) {
            const segment = this.segments[i];
            const targetDist = (i + 1) * this.SEGMENT_DISTANCE;
            
            while(historyIndex < this.pathHistory.length - 1) {
                const p1 = this.pathHistory[historyIndex].pos;
                const p2 = this.pathHistory[historyIndex + 1].pos;
                const d = p1.distanceTo(p2);
                
                if (distanceAccumulator + d >= targetDist) {
                    const remainder = targetDist - distanceAccumulator;
                    const alpha = remainder / d;
                    
                    segment.position.lerpVectors(p1, p2, alpha);
                    segment.quaternion.slerpQuaternions(this.pathHistory[historyIndex].quat, this.pathHistory[historyIndex+1].quat, alpha);
                    break;
                }
                
                distanceAccumulator += d;
                historyIndex++;
            }
        }
    }

    checkSelfCollision() {
        // Collision check should ideally ignore wave height to prevent "jumping over" yourself
        // We compare angular distance on sphere surface
        const headNorm = this.head.position.clone().normalize();
        
        // Skip first few segments
        for(let i = 4; i < this.segments.length; i++) {
            const segNorm = this.segments[i].position.clone().normalize();
            // Distance on unit sphere * radius
            if (headNorm.distanceTo(segNorm) * this.EARTH_RADIUS < 0.6) {
                return true;
            }
        }
        return false;
    }
}