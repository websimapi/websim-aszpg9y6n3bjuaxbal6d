import * as THREE from 'three';
import { Snake } from './snake.js';
import { FoodManager } from './food-manager.js';
import { AudioManager } from './audio-manager.js';
import { ReplayRecorder } from './replay-recorder.js';
import { hideLoader } from './loader.js';
import { getRippleHeight } from './math-utils.js';
import { IslandGenerator } from './island-generator.js';

export class Game {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        
        // Constants
        this.BASE_RADIUS = 10;
        this.EARTH_RADIUS = 10;
        
        // State
        this.isPlaying = false;
        this.isGameOver = false;
        this.score = 0;
        this.growthPoints = 0;
        this.time = 0;

        // Visuals
        this.rippleUniforms = {
            uTime: { value: 0 },
            uRippleCenters: { value: new Array(5).fill().map(() => new THREE.Vector3()) },
            uRippleStartTimes: { value: new Array(5).fill(-1000) },
            uRippleIntensities: { value: new Array(5).fill(0) }
        };
        this.currentRippleIdx = 0;
        
        // Player Info
        this.playerInfo = { username: 'Player', avatarUrl: '' };
        
        // Components
        this.audioManager = new AudioManager();
        this.recorder = new ReplayRecorder(30);
        
        // Entities
        this.earth = null;
        this.atm = null;
        this.snake = null; // Replaces head, segments, pathHistory
        this.foodManager = null; // Replaces food, bonusFoods, spawn logic
        this.island = null;

        this.targetPoint = null;

        this.init();
    }

    setPlayerInfo(info) {
        this.playerInfo = info;
        const avatarEl = document.getElementById('player-avatar');
        const nameEl = document.getElementById('player-name');
        const playerCardEl = document.getElementById('player-card');

        // Always set name immediately if available
        if (nameEl && info.username) {
            nameEl.textContent = info.username;
        }

        // If we don't have an avatar element, nothing more to do
        if (!avatarEl) return;

        const fallbackUrl = './default_avatar.png';
        const primaryUrl = info.avatarUrl || fallbackUrl;

        const tryLoad = (urlList, index = 0) => {
            if (index >= urlList.length) {
                // No image could be loaded; leave card hidden
                return;
            }

            const url = urlList[index];
            const img = new Image();
            img.onload = () => {
                avatarEl.src = url;
                // Once avatar (or fallback) is ready, fade in the whole experience together
                document.body.classList.add('ready');
                hideLoader(); // Fade out loading screen
                if (playerCardEl) {
                    // Fade in avatar, username, and score together
                    playerCardEl.classList.add('visible');
                }
            };
            img.onerror = () => {
                // Try next URL in the list
                tryLoad(urlList, index + 1);
            };
            img.src = url;
        };

        // Prefer provided avatar, then fallback to default
        tryLoad([primaryUrl === fallbackUrl ? fallbackUrl : primaryUrl, fallbackUrl]);
    }

    init() {
        // removed loadSound calls - now in AudioManager

        this.audioManager.load('eat', './snake_eat.mp3');
        this.audioManager.load('die', './game_over.mp3');

        // Create Earth
        this.createEarth();

        // removed Snake Head creation - moved to Snake class
        this.snake = new Snake(this.scene, this.EARTH_RADIUS);
        
        this.island = new IslandGenerator(this.scene);
        this.island.setRippleUniforms(this.rippleUniforms);

        // removed Food creation/spawning - moved to FoodManager
        this.foodManager = new FoodManager(this.scene, this.EARTH_RADIUS);
        this.foodManager.spawnFood(this.snake.head.position, this.snake.segments);

        this.resetGame();
    }
    
    createEarth() {
        const geometry = new THREE.SphereGeometry(this.EARTH_RADIUS, 64, 64);
        const material = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            emissive: 0x002244, 
            emissiveIntensity: 0.8,
            transparent: true,
            opacity: 0.7,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        // Inject Ripple Shader Logic
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.rippleUniforms.uTime;
            shader.uniforms.uRippleCenters = this.rippleUniforms.uRippleCenters;
            shader.uniforms.uRippleStartTimes = this.rippleUniforms.uRippleStartTimes;
            shader.uniforms.uRippleIntensities = this.rippleUniforms.uRippleIntensities;

            shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
            );

            const rippleFunc = `
                uniform float uTime;
                uniform vec3 uRippleCenters[5];
                uniform float uRippleStartTimes[5];
                uniform float uRippleIntensities[5];
                varying vec3 vWorldPos;

                float getRipple(int i, vec3 pos) {
                    float startTime = uRippleStartTimes[i];
                    if (startTime < 0.0) return 0.0;
                    
                    float age = uTime - startTime;
                    if (age < 0.0 || age > 2.0) return 0.0; // Lifetime 2s
                    
                    vec3 center = uRippleCenters[i];
                    float intensity = uRippleIntensities[i];
                    
                    float dotProd = dot(normalize(pos), normalize(center));
                    float angle = acos(clamp(dotProd, -1.0, 1.0));
                    float dist = angle * 10.0; // approx distance on sphere radius 10
                    
                    float speed = 8.0; 
                    float waveCenter = age * speed;
                    float distDiff = dist - waveCenter;
                    
                    float ripple = 0.0;
                    // Wave packet width
                    if (abs(distDiff) < 2.0) {
                        ripple = sin(distDiff * 3.0) * exp(-distDiff * distDiff);
                    }
                    
                    // Fade out
                    ripple *= (1.0 - age / 2.0);
                    ripple *= intensity;
                    return ripple;
                }
            `;

            shader.fragmentShader = rippleFunc + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>
                float totalRipple = 0.0;
                for(int i=0; i<5; i++) {
                    totalRipple += getRipple(i, vWorldPos);
                }
                if (abs(totalRipple) > 0.01) {
                    float strength = smoothstep(0.0, 0.5, abs(totalRipple));
                    vec3 rippleColor = vec3(0.7, 0.9, 1.0);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, rippleColor, strength * 0.4);
                    gl_FragColor.rgb += rippleColor * strength * 0.2;
                }`
            );
        };

        this.earth = new THREE.Mesh(geometry, material);
        this.scene.add(this.earth);
        
        const atmGeometry = new THREE.SphereGeometry(this.EARTH_RADIUS * 1.03, 64, 64);
        const atmMaterial = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide
        });
        this.atm = new THREE.Mesh(atmGeometry, atmMaterial);
        this.scene.add(this.atm);
    }
    
    resetGame() {
        // removed reset logic for segments/bonus foods - delegated to managers
        this.snake.reset();
        this.foodManager.reset();
        this.foodManager.spawnFood(this.snake.head.position, this.snake.segments);
        
        this.recorder.reset();

        // Reset Visuals
        this.rippleUniforms.uRippleStartTimes.value.fill(-1000);
        
        // Reset Island
        if (this.island.mesh) {
            this.scene.remove(this.island.mesh);
            this.island.mesh = null;
        }
        this.island.state = 'inactive';
        
        // Reset Radius
        this.EARTH_RADIUS = this.BASE_RADIUS;
        this.earth.scale.set(1, 1, 1);
        this.atm.scale.set(1, 1, 1);
        this.snake.EARTH_RADIUS = this.BASE_RADIUS;
        this.foodManager.EARTH_RADIUS = this.BASE_RADIUS;

        // Reset Camera
        this.updateCamera(0.1, true); // Force snap
        
        this.score = 0;
        this.growthPoints = 0;
        this.isGameOver = false;
        this.isPlaying = true;
        this.targetPoint = null;

        const scoreEl = document.getElementById('player-score');
        if(scoreEl) scoreEl.innerText = this.score;
        
        const gameOverEl = document.getElementById('game-over');
        if (gameOverEl) {
            gameOverEl.classList.add('hidden');
            gameOverEl.classList.remove('visible');
        }
    }

    playSound(name, volume = 1.0) {
        this.audioManager.play(name, volume);
        this.recorder.recordEvent(name, { volume });
    }

    setTarget(point) {
        if(this.isGameOver) return;
        this.audioManager.resume();
        this.targetPoint = point.clone().normalize().multiplyScalar(this.EARTH_RADIUS);
    }

    triggerRipple(point, durationMs) {
        const idx = this.currentRippleIdx;
        this.rippleUniforms.uRippleCenters.value[idx].copy(point);
        this.rippleUniforms.uRippleStartTimes.value[idx] = this.time;
        
        // Intensity logic based on hold duration
        // Short tap (<200ms) -> 0.15
        // Long tap (>600ms) -> 0.45
        let intensity = 0.15;
        if (durationMs > 200) {
            const factor = Math.min((durationMs - 200) / 400, 1.0);
            intensity = 0.15 + factor * 0.3;
        }
        
        this.rippleUniforms.uRippleIntensities.value[idx] = intensity;
        
        this.currentRippleIdx = (this.currentRippleIdx + 1) % 5;

        // Record for replay
        this.recorder.recordEvent('ripple', { 
            center: point.toArray(), 
            duration: durationMs 
        });
    }

    update(dt) {
        this.time += dt;
        this.rippleUniforms.uTime.value = this.time;

        if(this.isGameOver) return;
        
        // Update Sphere Radius based on Score
        // Growth function: R = Base + 2 * log(1 + Score/10)
        const targetRadius = this.BASE_RADIUS + 2.0 * Math.log(1 + this.score / 10);
        // Smoothly interpolate current radius
        const growthSpeed = 0.5;
        this.EARTH_RADIUS = THREE.MathUtils.lerp(this.EARTH_RADIUS, targetRadius, dt * growthSpeed);
        
        // Update visuals scale
        const s = this.EARTH_RADIUS / this.BASE_RADIUS;
        this.earth.scale.set(s, s, s);
        this.atm.scale.set(s, s, s);
        
        // Update Dependencies
        this.snake.EARTH_RADIUS = this.EARTH_RADIUS;
        this.foodManager.EARTH_RADIUS = this.EARTH_RADIUS;

        // Handle Island
        if (this.score >= 50 && this.island.state === 'inactive') {
            this.island.trigger(this.EARTH_RADIUS);
        }
        this.island.update(dt, this.EARTH_RADIUS, this.snake);

        // Prepare Surface Info Function
        // Returns { height, normal } at a given position
        const getSurfaceInfo = (pos) => {
            const posNorm = pos.clone().normalize();
            
            // 1. Base Sphere Normal is just the position direction
            const sphereNormal = posNorm.clone();
            
            // 2. Ripple Height
            const rH = getRippleHeight(
                pos,
                this.time,
                this.rippleUniforms.uRippleCenters.value,
                this.rippleUniforms.uRippleStartTimes.value,
                this.rippleUniforms.uRippleIntensities.value,
                this.EARTH_RADIUS
            );
            
            // 3. Island Height & Normal
            const iData = this.island.getHeightAndNormal(posNorm, this.EARTH_RADIUS);
            
            // Combine
            // We assume ripple doesn't change normal significantly for physics, just visual offset
            // But Island changes normal significantly
            
            return {
                height: iData.height + rH,
                normal: iData.normal // This already includes slope
            };
        };

        // 1. Update Snake
        // removed movement logic block - delegated to Snake.update
        const moveDist = this.snake.update(dt, this.targetPoint, getSurfaceInfo);
        if (moveDist > 0 && this.targetPoint && this.snake.head.position.distanceTo(this.targetPoint) < 1.0) {
            this.targetPoint = null;
        }

        // 2. Update Food Manager (Pulse anims, Bonus spawning)
        // removed bonus spawn logic - delegated to FoodManager
        this.foodManager.update(moveDist, this.snake.getTailPosition(), getSurfaceInfo);

        // 3. Collision Checks
        // We need to pass the "logic" position (surface level) or handle it inside
        // Since snake.head.position is now visually displaced, we should normalize for collision checks
        // or checkCollision can handle it.
        const collisions = this.foodManager.checkCollisions(this.snake.head.position);
        
        if (collisions.mainFood) {
            this.playSound('eat', 0.33);
            this.score += 5;
            this.growthPoints += 5;
            
            const scoreEl = document.getElementById('player-score');
            if(scoreEl) scoreEl.innerText = this.score;
            
            this.foodManager.spawnFood(this.snake.head.position, this.snake.segments);
            
            if (Math.random() < 0.5) {
                this.foodManager.spawnBonusTrail(5);
            }

            // Give a nice tongue slither on big bites
            this.snake.triggerTongue();
        }
        
        // Sort indices descending to remove safely
        collisions.bonusIndices.sort((a,b) => b-a).forEach(idx => {
            this.playSound('eat', 0.33);
            this.score += 1;
            this.growthPoints += 1;
            const scoreEl = document.getElementById('player-score');
            if(scoreEl) scoreEl.innerText = this.score;
            this.foodManager.removeBonusFood(idx);

            // Flick tongue on snack-sized bonus foods
            this.snake.triggerTongue();
        });

        // Check Growth
        while (this.growthPoints >= 10) {
            this.snake.addSegment();
            this.growthPoints -= 10;
        }

        // 4. Check Self Collision
        // removed loop - delegated to Snake
        if (this.snake.checkSelfCollision()) {
            this.gameOver();
        }

        // 5. Update Camera
        this.updateCamera(dt);

        // 6. Record Frame
        // removed recordFrame implementation - delegated to ReplayRecorder
        this.recorder.update(dt, () => this.getSnapshot());
    }
    
    updateCamera(dt, snap = false) {
        // Target Distance: Maintain constant height above surface (approx 22 units)
        // User requested "away", so increased base distance slightly from 30 to 32
        const dist = 32 + (this.EARTH_RADIUS - 10); 
        const idealCameraPos = this.snake.head.position.clone().normalize().multiplyScalar(dist);
        
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
        const sphereNormal = this.snake.head.position.clone().normalize();
        const snakeForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.snake.head.quaternion);
        
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

    getSnapshot() {
        return {
            head: {
                pos: this.snake.head.position.toArray(),
                quat: this.snake.head.quaternion.toArray()
            },
            camera: {
                pos: this.camera.position.toArray(),
                quat: this.camera.quaternion.toArray(),
                up: this.camera.up.toArray()
            },
            food: this.foodManager.food.position.toArray(),
            bonusFoods: this.foodManager.bonusFoods.map(b => b.position.toArray()),
            segments: this.snake.segments.map(seg => ({
                pos: seg.position.toArray(),
                quat: seg.quaternion.toArray(),
                color: seg.material.color.getHex()
            })),
            score: this.score,
            tongue: {
                scaleX: this.snake.tongue ? this.snake.tongue.scale.x : 1,
                scaleZ: this.snake.tongue ? this.snake.tongue.scale.z : 0.01
            },
            island: this.island && this.island.mesh ? {
                visible: this.island.mesh.visible,
                scale: this.island.mesh.scale.x,
                center: this.island.center.toArray(),
                quaternion: this.island.mesh.quaternion.toArray()
            } : null,
            earthRadius: this.EARTH_RADIUS,
            events: [] // Filled by recorder
        };
    }

    getReplayJSON() {
        return this.recorder.getReplayJSON({
            earthRadius: this.EARTH_RADIUS,
            fps: this.recorder.RECORD_FPS,
            playerInfo: this.playerInfo,
            sounds: {
                eat: './snake_eat.mp3',
                die: './game_over.mp3'
            },
            muted: this.audioManager.isMuted()
        });
    }

    gameOver() {
        this.isGameOver = true;
        this.playSound('die');
        // Force a final record
        this.recorder.update(100, () => this.getSnapshot()); 
        
        const gameOverEl = document.getElementById('game-over');
        const restartBtn = document.getElementById('btn-restart');
        const replayBtn = document.getElementById('btn-replay');

        // Disable buttons initially to prevent misclicks
        if (restartBtn) restartBtn.disabled = true;
        if (replayBtn) replayBtn.disabled = true;

        if (gameOverEl) {
            gameOverEl.classList.remove('hidden');
            // Allow display: none to clear before starting transition
            requestAnimationFrame(() => {
                gameOverEl.classList.add('visible');
            });

            // Re-enable buttons shortly after fade-in starts
            setTimeout(() => {
                if (restartBtn) restartBtn.disabled = false;
                if (replayBtn) replayBtn.disabled = false;
            }, 700);
        }
        this.isPlaying = false;
    }
}