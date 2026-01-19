import * as THREE from 'three';
import { calculateIslandHeight, createIslandMesh } from './island-geometry.js';

export class IslandGenerator {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.center = new THREE.Vector3(0, 1, 0); // Target center direction on Earth
        this.state = 'inactive'; // inactive, spawning, docked
        this.progress = 0; // 0 to 1
        this.baseRadius = 10; // Fixed base radius for generation to ensure consistent noise features
        
        // Reusable vectors for physics to avoid garbage
        this._localDir = new THREE.Vector3();
        this._dummyQ = new THREE.Quaternion();

        // Combined Uniforms (Sand Physics + Tides)
        this.sandUniforms = {
            uSnakePoints: { value: new Array(20).fill().map(() => new THREE.Vector3()) },
            uSnakeCount: { value: 0 },
            uTime: { value: 0 },
            uGlobalScale: { value: 1.0 },
            // Tides / Ripples - References will be copied from Game
            uRippleCenters: { value: new Array(5).fill().map(() => new THREE.Vector3()) },
            uRippleStartTimes: { value: new Array(5).fill(-1000) },
            uRippleIntensities: { value: new Array(5).fill(0) },
            uEarthRadius: { value: 10.0 }
        };
    }

    setRippleUniforms(rippleUniforms) {
        // Link our uniforms to the game's ripple uniforms for synchronization
        this.sandUniforms.uRippleCenters = rippleUniforms.uRippleCenters;
        this.sandUniforms.uRippleStartTimes = rippleUniforms.uRippleStartTimes;
        this.sandUniforms.uRippleIntensities = rippleUniforms.uRippleIntensities;
        this.sandUniforms.uTime = rippleUniforms.uTime;
    }

    trigger(earthRadius) {
        if (this.state !== 'inactive') return;
        
        // 1. Determine Location
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        
        this.center.set(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
        ).normalize();
        
        // 2. Generate Proper Mesh
        // Always generate at base radius; we handle growth via scaling
        this.createMesh(this.baseRadius);
        
        // 3. Start Animation
        this.state = 'spawning';
        this.progress = 0;
        this.mesh.visible = true;
    }

    createMesh(radius) {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            if(this.mesh.geometry) this.mesh.geometry.dispose();
            if(this.mesh.material) this.mesh.material.dispose();
        }

        // Generate the detailed terrain mesh
        this.mesh = createIslandMesh(radius);
        
        // Inject Sand Physics Shader
        this.mesh.material.onBeforeCompile = (shader) => {
            shader.uniforms.uSnakePoints = this.sandUniforms.uSnakePoints;
            shader.uniforms.uSnakeCount = this.sandUniforms.uSnakeCount;
            shader.uniforms.uGlobalScale = this.sandUniforms.uGlobalScale;
            
            shader.uniforms.uTime = this.sandUniforms.uTime;
            shader.uniforms.uRippleCenters = this.sandUniforms.uRippleCenters;
            shader.uniforms.uRippleStartTimes = this.sandUniforms.uRippleStartTimes;
            shader.uniforms.uRippleIntensities = this.sandUniforms.uRippleIntensities;

            shader.vertexShader = `
                uniform vec3 uSnakePoints[20];
                uniform int uSnakeCount;
                uniform float uGlobalScale;
                varying vec3 vWorldPos;
                varying float vIsBeach;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                
                vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
                vWorldPos = worldPosition.xyz;

                vIsBeach = 0.0;
                #ifdef USE_COLOR
                    if (color.r > 0.6 && color.g > 0.5) {
                        vIsBeach = 1.0;
                    }
                #endif

                if (vIsBeach > 0.5 && uSnakeCount > 0) {
                    vec3 accumulatedOffset = vec3(0.0);
                    for(int i = 0; i < 20; i++) {
                        if (i >= uSnakeCount) break;
                        vec3 sPos = uSnakePoints[i];
                        float dist = distance(worldPosition.xyz, sPos);
                        float radius = 1.5 * uGlobalScale;
                        if (dist < radius) {
                            float strength = pow(1.0 - (dist / radius), 2.0);
                            vec3 dir = normalize(worldPosition.xyz - sPos);
                            accumulatedOffset += dir * strength * 0.5 * uGlobalScale;
                            accumulatedOffset += normal * strength * 0.35 * uGlobalScale;
                        }
                    }
                    transformed += accumulatedOffset;
                }
                `
            );
            
            const rippleFrag = `
                uniform float uTime;
                uniform vec3 uRippleCenters[5];
                uniform float uRippleStartTimes[5];
                uniform float uRippleIntensities[5];
                varying vec3 vWorldPos;
                varying float vIsBeach;
                
                float getRippleAt(vec3 pos) {
                    float total = 0.0;
                    vec3 pNorm = normalize(pos);
                    for(int i=0; i<5; i++) {
                        float startTime = uRippleStartTimes[i];
                        if (startTime < 0.0) continue;
                        float age = uTime - startTime;
                        if (age < 0.0 || age > 2.0) continue;
                        vec3 center = uRippleCenters[i];
                        float intensity = uRippleIntensities[i];
                        float dotProd = dot(pNorm, normalize(center));
                        float angle = acos(clamp(dotProd, -1.0, 1.0));
                        float dist = angle * 10.0;
                        float speed = 8.0; 
                        float waveCenter = age * speed;
                        float distDiff = dist - waveCenter;
                        if (abs(distDiff) < 2.0) {
                            float ripple = sin(distDiff * 3.0) * exp(-distDiff * distDiff);
                            ripple *= (1.0 - age / 2.0);
                            ripple *= intensity;
                            total += ripple;
                        }
                    }
                    return total;
                }
            `;

            shader.fragmentShader = rippleFrag + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>
                if (vIsBeach > 0.5) {
                    float rVal = getRippleAt(vWorldPos);
                    if (abs(rVal) > 0.05) {
                        float wet = smoothstep(0.05, 0.3, abs(rVal));
                        vec3 wetColor = gl_FragColor.rgb * 0.6 + vec3(0.1, 0.2, 0.3) * 0.2;
                        gl_FragColor.rgb = mix(gl_FragColor.rgb, wetColor, wet * 0.8);
                    }
                }`
            );
        };

        // Align mesh to the target center
        // The mesh is generated at North Pole (0, 1, 0)
        // We rotate it to align (0, 1, 0) with this.center
        const alignQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.center);
        this.mesh.quaternion.copy(alignQ);
        
        // Initially scale down for spawn effect
        this.mesh.scale.set(0.1, 0.1, 0.1);
        
        this.scene.add(this.mesh);
    }

    // Get height at a specific direction (normalized) relative to sphere center
    getHeightAndNormal(direction, earthRadius) {
        if ((this.state !== 'docked' && this.state !== 'spawning') || !this.mesh) return { height: 0, normal: direction.clone() };

        // Scale Factor (Earth has grown, island grows with it)
        const scale = earthRadius / this.baseRadius;

        // 1. Transform world direction into Island Local Space (where island is at North Pole)
        const invQ = this.mesh.quaternion.clone().invert();
        const localDir = direction.clone().applyQuaternion(invQ); // Should be near (0, 1, 0)

        // Fix ghost island on opposite side:
        // Projecting sphere surface to XZ plane (used in calculateIslandHeight) is ambiguous for poles (both 0,0).
        // We restrict island influence to the top hemisphere (localDir.y > threshold).
        // Island radius is ~72 deg => cos(72) ~ 0.3. We use 0.2 as a safe cutoff to ignore the antipode.
        if (localDir.y < 0.2) return { height: 0, normal: direction.clone() };
        
        // 2. Calculate coordinates on the BASE sphere
        // localDir is normalized. We map it to the BASE radius to check noise consistency
        const px = localDir.x * this.baseRadius;
        const py = localDir.y * this.baseRadius;
        const pz = localDir.z * this.baseRadius;
        
        // 3. Get Base Height
        const hBase = calculateIslandHeight(px, py, pz, this.baseRadius);
        
        if (hBase <= 0.001) return { height: 0, normal: direction.clone() };
        
        // 4. Calculate Normal (Finite Difference approximation in Base Space)
        const eps = 0.1;
        const hx = calculateIslandHeight(px + eps, py, pz, this.baseRadius);
        const hz = calculateIslandHeight(px, py, pz + eps, this.baseRadius);
        
        // Slopes
        const dhdx = (hx - hBase) / eps;
        const dhdz = (hz - hBase) / eps;
        
        const localNormal = new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
        
        // 5. Transform normal back to world space
        const worldNormal = localNormal.applyQuaternion(this.mesh.quaternion);

        // 6. Calculate Final Height
        // Scale the base height directly.
        // We clamp to 0 to ensure snake stays on water surface when over the underwater skirt,
        // effectively treating the ocean as a solid floor at height 0.
        const hPhysical = Math.max(0, hBase * scale);

        return { height: hPhysical, normal: worldNormal };
    }

    update(dt, earthRadius, snake) {
        if (this.state === 'inactive') return;
        
        // Always maintain scale ratio with Earth growth
        const globalScale = earthRadius / this.baseRadius;
        this.sandUniforms.uGlobalScale.value = globalScale;

        // Update Snake Uniforms
        if (snake && snake.segments) {
            let count = 0;
            
            // Add head
            if (count < 20) {
                this.sandUniforms.uSnakePoints.value[count].copy(snake.head.position);
                count++;
            }
            
            // Add segments (stride to save uniforms)
            for(let i=0; i<snake.segments.length; i+=2) {
                if (count >= 20) break;
                this.sandUniforms.uSnakePoints.value[count].copy(snake.segments[i].position);
                count++;
            }
            this.sandUniforms.uSnakeCount.value = count;
        }

        if (this.state === 'docked') {
             if (this.mesh) {
                 this.mesh.scale.setScalar(globalScale);
             }
             return;
        }
        
        this.progress += dt * 0.3; // Rise over ~3 seconds
        
        if (this.progress >= 1.0) {
            this.progress = 1.0;
            this.state = 'docked';
            this.mesh.scale.setScalar(globalScale);
        } else {
            // Animation: "Breach" effect
            const p = this.progress;
            const animScale = THREE.MathUtils.smoothstep(p, 0, 1);
            
            // Combined Scale: Earth Growth * Spawning Animation
            this.mesh.scale.setScalar(globalScale * animScale);
        }
    }
}