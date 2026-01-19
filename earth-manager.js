import * as THREE from 'three';
import { getRippleHeight } from './math-utils.js';

export class EarthManager {
    constructor(scene, baseRadius = 10) {
        this.scene = scene;
        this.BASE_RADIUS = baseRadius;
        this.currentRadius = baseRadius;
        this.earth = null;
        this.atm = null;

        this.rippleUniforms = {
            uTime: { value: 0 },
            uRippleCenters: { value: new Array(5).fill().map(() => new THREE.Vector3()) },
            uRippleStartTimes: { value: new Array(5).fill(-1000) },
            uRippleIntensities: { value: new Array(5).fill(0) }
        };
        this.currentRippleIdx = 0;

        this.init();
    }

    init() {
        const geometry = new THREE.SphereGeometry(this.BASE_RADIUS, 64, 64);
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
        
        const atmGeometry = new THREE.SphereGeometry(this.BASE_RADIUS * 1.03, 64, 64);
        const atmMaterial = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide
        });
        this.atm = new THREE.Mesh(atmGeometry, atmMaterial);
        this.scene.add(this.atm);
    }

    update(dt, time, radius) {
        this.rippleUniforms.uTime.value = time;
        this.currentRadius = radius;

        // Update visuals scale
        const s = this.currentRadius / this.BASE_RADIUS;
        if (this.earth) this.earth.scale.set(s, s, s);
        if (this.atm) this.atm.scale.set(s, s, s);
    }

    triggerRipple(point, time, durationMs) {
        const idx = this.currentRippleIdx;
        this.rippleUniforms.uRippleCenters.value[idx].copy(point);
        this.rippleUniforms.uRippleStartTimes.value[idx] = time;
        
        // Intensity logic
        let intensity = 0.15;
        if (durationMs > 200) {
            const factor = Math.min((durationMs - 200) / 400, 1.0);
            intensity = 0.15 + factor * 0.3;
        }
        
        this.rippleUniforms.uRippleIntensities.value[idx] = intensity;
        this.currentRippleIdx = (this.currentRippleIdx + 1) % 5;
    }

    reset() {
        this.rippleUniforms.uRippleStartTimes.value.fill(-1000);
        this.currentRadius = this.BASE_RADIUS;
        if (this.earth) this.earth.scale.set(1, 1, 1);
        if (this.atm) this.atm.scale.set(1, 1, 1);
    }

    getRippleHeightAt(pos, time) {
        return getRippleHeight(
            pos,
            time,
            this.rippleUniforms.uRippleCenters.value,
            this.rippleUniforms.uRippleStartTimes.value,
            this.rippleUniforms.uRippleIntensities.value,
            this.currentRadius
        );
    }
}