import * as THREE from 'three';
import { getRandomPointOnSphere } from './math-utils.js';

export class FoodManager {
    constructor(scene, earthRadius) {
        this.scene = scene;
        this.EARTH_RADIUS = earthRadius;
        
        this.food = null;
        this.bonusFoods = [];
        
        // Spawning Logic
        this.bonusSpawnQueue = 0;
        this.bonusSpawnDist = 0;
        
        this.init();
    }

    init() {
        const foodGeo = new THREE.SphereGeometry(0.5, 16, 16);
        const foodMat = new THREE.MeshStandardMaterial({ 
            color: 0xffaa00, 
            emissive: 0xff0000, 
            emissiveIntensity: 0.5 
        });
        this.food = new THREE.Mesh(foodGeo, foodMat);
        this.scene.add(this.food);
    }

    reset() {
        this.bonusFoods.forEach(f => this.scene.remove(f));
        this.bonusFoods = [];
        this.bonusSpawnQueue = 0;
        this.bonusSpawnDist = 0;
    }

    spawnFood(snakeHeadPos, snakeSegments) {
        let valid = false;
        let pos = new THREE.Vector3();
        let tries = 0;
        
        while(!valid && tries < 20) {
            pos = getRandomPointOnSphere(this.EARTH_RADIUS);
            valid = true;
            
            // Check distance to head
            if(pos.distanceTo(snakeHeadPos) < 5) valid = false;
            
            // Check distance to segments
            for(let seg of snakeSegments) {
                if(pos.distanceTo(seg.position) < 2) {
                    valid = false;
                    break;
                }
            }
            tries++;
        }
        
        this.food.position.copy(pos);
        this.food.lookAt(new THREE.Vector3(0,0,0));
    }

    spawnBonusTrail(amount = 5) {
        this.bonusSpawnQueue += amount;
    }

    spawnSingleBonusFood(position) {
        const geo = new THREE.SphereGeometry(0.25, 8, 8);
        const mat = new THREE.MeshStandardMaterial({ 
            color: 0xffff00, 
            emissive: 0xffaa00,
            emissiveIntensity: 0.5 
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(position);
        mesh.position.normalize().multiplyScalar(this.EARTH_RADIUS);
        
        this.scene.add(mesh);
        this.bonusFoods.push(mesh);
    }

    update(moveDist, snakeTailPos, surfaceInfoFn) {
        // Apply Physics to Food (Height adjustment)
        if (surfaceInfoFn) {
            this.applySurfaceToFood(this.food, surfaceInfoFn);
            this.bonusFoods.forEach(b => this.applySurfaceToFood(b, surfaceInfoFn));
        }

        // Handle Bonus Spawning
        if (this.bonusSpawnQueue > 0) {
            this.bonusSpawnDist += moveDist;
            const SPACING = 1.5; 
            
            while (this.bonusSpawnDist >= SPACING && this.bonusSpawnQueue > 0) {
                this.bonusSpawnDist -= SPACING;
                this.bonusSpawnQueue--;
                this.spawnSingleBonusFood(snakeTailPos);
            }
        }
    }
    
    applySurfaceToFood(mesh, surfaceInfoFn) {
        const info = surfaceInfoFn(mesh.position);
        // Food radius 0.5, bonus 0.25. Let's just offset by radius approx so it sits on top.
        // If mesh is main food (R=0.5), offset 0.5. If bonus (R=0.25), offset 0.25.
        // We can check geometry radius or just approximate.
        const radius = mesh.geometry.parameters.radius || 0.3;
        mesh.position.setLength(this.EARTH_RADIUS + info.height + radius * 0.8); 
    }
    
    checkCollisions(snakeHeadPos) {
        const results = {
            mainFood: false,
            bonusIndices: []
        };

        // Use Normalized positions for reliable collision even during jumps
        const headNorm = snakeHeadPos.clone().normalize();
        const foodNorm = this.food.position.clone().normalize();

        // Main Food
        // Use angular distance approximation: dist on unit sphere * Radius
        if (headNorm.distanceTo(foodNorm) * this.EARTH_RADIUS < 1.5) {
            results.mainFood = true;
        }

        // Bonus Foods
        for (let i = this.bonusFoods.length - 1; i >= 0; i--) {
            const bonus = this.bonusFoods[i];
            const bonusNorm = bonus.position.clone().normalize();
            
            if (headNorm.distanceTo(bonusNorm) * this.EARTH_RADIUS < 1.2) {
                results.bonusIndices.push(i);
            }
        }
        
        return results;
    }

    removeBonusFood(index) {
        const bonus = this.bonusFoods[index];
        if (bonus) {
            this.scene.remove(bonus);
            this.bonusFoods.splice(index, 1);
        }
    }
}