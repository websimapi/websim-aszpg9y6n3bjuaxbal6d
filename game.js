import * as THREE from 'three';
import { Snake } from './snake.js';
import { FoodManager } from './food-manager.js';
import { AudioManager } from './audio-manager.js';
import { ReplayRecorder } from './replay-recorder.js';
import { hideLoader } from './loader.js';
import { IslandGenerator } from './island-generator.js';
import { CameraManager } from './camera-manager.js';
import { EarthManager } from './earth-manager.js';

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

        // Player Info
        this.playerInfo = { username: 'Player', avatarUrl: '' };
        
        // Components
        this.audioManager = new AudioManager();
        this.recorder = new ReplayRecorder(30);
        this.cameraManager = new CameraManager(camera);
        
        // Entities
        this.earthManager = new EarthManager(scene, this.BASE_RADIUS);
        this.snake = null; 
        this.foodManager = null;
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
        this.audioManager.load('eat', './snake_eat.mp3');
        this.audioManager.load('die', './game_over.mp3');

        // EarthManager handles creation and scene addition
        // removed createEarth() - logic moved to EarthManager

        this.snake = new Snake(this.scene, this.EARTH_RADIUS);
        
        this.island = new IslandGenerator(this.scene);
        this.island.setRippleUniforms(this.earthManager.rippleUniforms);

        this.foodManager = new FoodManager(this.scene, this.EARTH_RADIUS);
        this.foodManager.spawnFood(this.snake.head.position, this.snake.segments);

        this.resetGame();
    }
    
    // removed createEarth() {} - logic moved to EarthManager
    
    resetGame() {
        // removed reset logic for segments/bonus foods - delegated to managers
        this.snake.reset();
        this.foodManager.reset();
        this.foodManager.spawnFood(this.snake.head.position, this.snake.segments);
        
        this.recorder.reset();

        // Reset Visuals
        this.earthManager.reset();
        
        // Reset Island
        if (this.island.mesh) {
            this.scene.remove(this.island.mesh);
            this.island.mesh = null;
        }
        this.island.state = 'inactive';
        
        // Reset Radius
        this.EARTH_RADIUS = this.BASE_RADIUS;
        this.snake.EARTH_RADIUS = this.BASE_RADIUS;
        this.foodManager.EARTH_RADIUS = this.BASE_RADIUS;

        // Reset Camera
        this.cameraManager.update(0.1, this.snake.head.position, this.snake.head.quaternion, this.EARTH_RADIUS, true);
        
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
        this.earthManager.triggerRipple(point, this.time, durationMs);

        // Record for replay
        this.recorder.recordEvent('ripple', { 
            center: point.toArray(), 
            duration: durationMs 
        });
    }

    update(dt) {
        this.time += dt;

        if(this.isGameOver) return;
        
        // Update Sphere Radius based on Score
        // Growth function: R = Base + 2 * log(1 + Score/10)
        const targetRadius = this.BASE_RADIUS + 2.0 * Math.log(1 + this.score / 10);
        // Smoothly interpolate current radius
        const growthSpeed = 0.5;
        this.EARTH_RADIUS = THREE.MathUtils.lerp(this.EARTH_RADIUS, targetRadius, dt * growthSpeed);
        
        // Update Earth Manager (Visuals & Uniforms)
        this.earthManager.update(dt, this.time, this.EARTH_RADIUS);
        
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
            
            // 1. Ripple Height
            const rH = this.earthManager.getRippleHeightAt(pos, this.time);
            
            // 2. Island Height & Normal
            const iData = this.island.getHeightAndNormal(posNorm, this.EARTH_RADIUS);
            
            // Combine
            return {
                height: iData.height + rH,
                normal: iData.normal 
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
        this.cameraManager.update(dt, this.snake.head.position, this.snake.head.quaternion, this.EARTH_RADIUS);

        // 6. Record Frame
        // removed recordFrame implementation - delegated to ReplayRecorder
        this.recorder.update(dt, () => this.getSnapshot());
    }
    
    // removed updateCamera() - logic moved to CameraManager

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