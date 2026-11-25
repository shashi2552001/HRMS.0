import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ChevronDown, ChevronUp, Layers, RotateCcw } from 'lucide-react';
import {
  create9HRSealTexture,
  createContactShadowTexture,
  createStudioRenderer,
  detectSoftwareWebGL,
  disposeObjectTree,
  setupStudioEnvironment,
  waitForSoftwareDraw,
} from './threeUtils.ts';

type CameraPreset = 'hero' | 'crest' | 'side';

const CAMERA_PRESETS: Record<
  CameraPreset,
  { pos: [number, number, number]; target: [number, number, number]; label: string }
> = {
  hero: { pos: [0, 2.35, 6.1], target: [0, 1.55, 0], label: 'Vault Hero' },
  crest: { pos: [0.35, 4.6, 3.6], target: [0, 1.55, 0], label: 'Crest View' },
  side: { pos: [5.1, 2.0, 3.1], target: [0, 1.55, 0], label: 'Profile' },
};

// Module-scope reusable math helpers (zero GC inside animation loop)
const _targetPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export function OnboardingVaultScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [preset, setPreset] = useState<CameraPreset>('hero');
  const [explode, setExplode] = useState<number>(0);
  const [autoSpin, setAutoSpin] = useState<boolean>(true);
  const [hudCollapsed, setHudCollapsed] = useState<boolean>(false);

  const stateRef = useRef({
    explodeTarget: 0,
    explodeCurrent: 0,
    autoSpin: true,
    cameraPresetActive: false,
    camPos: new THREE.Vector3(...CAMERA_PRESETS.hero.pos),
    camLook: new THREE.Vector3(...CAMERA_PRESETS.hero.target),
  });

  useEffect(() => {
    stateRef.current.explodeTarget = explode;
  }, [explode]);

  useEffect(() => {
    stateRef.current.autoSpin = autoSpin;
  }, [autoSpin]);

  const applyPreset = (next: CameraPreset) => {
    setPreset(next);
    const cfg = CAMERA_PRESETS[next];
    stateRef.current.camPos.set(...cfg.pos);
    stateRef.current.camLook.set(...cfg.target);
    stateRef.current.cameraPresetActive = true;
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const renderer = createStudioRenderer(container, isSoftwareGl);
    const scene = new THREE.Scene();
    const bgHex = 0x071222;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.045);

    const envTexture = setupStudioEnvironment(scene, renderer);

    const camera = new THREE.PerspectiveCamera(
      40,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      80
    );
    camera.position.set(...CAMERA_PRESETS.hero.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAMERA_PRESETS.hero.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 3.4;
    controls.maxDistance = 10.5;
    controls.minPolarAngle = 0.28;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.update();

    const onControlStart = () => {
      stateRef.current.cameraPresetActive = false;
    };
    controls.addEventListener('start', onControlStart);

    // 3-Point Warm/Cool Studio Lighting Rig
    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x0b192c, 0.75);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.4);
    keyLight.position.set(5.5, 8.5, 6.0);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 24;
      const d = 4.2;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x10b981, 1.55);
    rimLight.position.set(-5.0, 4.2, -4.5);
    scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.9);
    fillLight.position.set(4.0, 2.0, -4.5);
    scene.add(fillLight);

    // Ground Stage + Contact Shadow Plane
    const stageGroup = new THREE.Group();
    scene.add(stageGroup);

    const floorGeo = new THREE.CircleGeometry(14, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x091629,
      roughness: 0.78,
      metalness: 0.25,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = !isSoftwareGl;
    stageGroup.add(floorMesh);

    const shadowTex = createContactShadowTexture();
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 5.6),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.02;
    stageGroup.add(shadowPlane);

    // -------------------------------------------------------------------------
    // Hero Subject Group: Composite 9HR India Digital Onboarding Vault (12+ parts)
    // -------------------------------------------------------------------------
    const heroGroup = new THREE.Group();
    heroGroup.position.set(0, 0, 0);
    scene.add(heroGroup);

    // Part 1: Stepped Lathe Pedestal Base (flush on y = 0)
    const plinthPoints = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(1.92, 0.0),
      new THREE.Vector2(1.92, 0.11),
      new THREE.Vector2(1.76, 0.16),
      new THREE.Vector2(1.56, 0.16),
      new THREE.Vector2(1.52, 0.29),
      new THREE.Vector2(1.24, 0.34),
      new THREE.Vector2(0.0, 0.34),
    ];
    const plinthGeo = new THREE.LatheGeometry(plinthPoints, 56);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x0f1f36,
      roughness: 0.58,
      metalness: 0.42,
    });
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.castShadow = !isSoftwareGl;
    plinthMesh.receiveShadow = !isSoftwareGl;
    heroGroup.add(plinthMesh);

    // Part 2: Brushed Brass / Gold Precision Accent Collar
    const collarGeo = new THREE.TorusGeometry(1.56, 0.038, 18, 64);
    const goldMat = new THREE.MeshPhysicalMaterial({
      color: 0xf59e0b,
      metalness: 0.92,
      roughness: 0.18,
      anisotropy: 0.8,
      clearcoat: 0.4,
    });
    const collarMesh = new THREE.Mesh(collarGeo, goldMat);
    collarMesh.rotation.x = Math.PI / 2;
    collarMesh.position.y = 0.24;
    heroGroup.add(collarMesh);

    // Part 3: Recessed Emerald Status Light Ring
    const ringGlowGeo = new THREE.TorusGeometry(1.24, 0.022, 14, 64);
    const emeraldGlowMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.9,
      roughness: 0.25,
      metalness: 0.6,
    });
    const ringGlowMesh = new THREE.Mesh(ringGlowGeo, emeraldGlowMat);
    ringGlowMesh.rotation.x = Math.PI / 2;
    ringGlowMesh.position.y = 0.355;
    heroGroup.add(ringGlowMesh);

    // Rotating Assembly Pivot (centered at y = 1.65 above pedestal)
    const vaultCoreGroup = new THREE.Group();
    vaultCoreGroup.position.set(0, 1.68, 0);
    heroGroup.add(vaultCoreGroup);

    // Part 4: Brushed Titanium Gimbal Outer Ring
    const gimbalMat = new THREE.MeshPhysicalMaterial({
      color: 0xcbd5e1,
      metalness: 0.9,
      roughness: 0.22,
      anisotropy: 0.75,
    });
    const gimbalMesh = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.045, 20, 72), gimbalMat);
    gimbalMesh.castShadow = !isSoftwareGl;
    vaultCoreGroup.add(gimbalMesh);

    // Parts 5-8: Four Beveled Brand Arcs (9HR Signature Palette)
    const arcConfigs: Array<{
      start: number;
      end: number;
      color: number;
      dir: THREE.Vector3;
    }> = [
      { start: 0.12, end: Math.PI * 0.46, color: 0x0f172a, dir: new THREE.Vector3(1, 1, 0).normalize() },
      { start: Math.PI * 0.54, end: Math.PI * 0.96, color: 0x2563eb, dir: new THREE.Vector3(-1, 1, 0).normalize() },
      { start: Math.PI * 1.04, end: Math.PI * 1.46, color: 0x059669, dir: new THREE.Vector3(-1, -1, 0).normalize() },
      { start: Math.PI * 1.54, end: Math.PI * 1.88, color: 0xd97706, dir: new THREE.Vector3(1, -1, 0).normalize() },
    ];

    const arcMeshes: Array<{ mesh: THREE.Mesh; dir: THREE.Vector3 }> = [];
    for (const cfg of arcConfigs) {
      const arcShape = new THREE.Shape();
      const outerR = 1.19;
      const innerR = 1.02;
      arcShape.absarc(0, 0, outerR, cfg.start, cfg.end, false);
      arcShape.absarc(0, 0, innerR, cfg.end, cfg.start, true);
      arcShape.closePath();

      const arcGeo = new THREE.ExtrudeGeometry(arcShape, {
        depth: 0.14,
        bevelEnabled: true,
        bevelThickness: 0.025,
        bevelSize: 0.022,
        bevelSegments: 3,
        curveSegments: 24,
      });
      arcGeo.translate(0, 0, -0.07);

      const arcMat = new THREE.MeshPhysicalMaterial({
        color: cfg.color,
        metalness: 0.45,
        roughness: 0.24,
        clearcoat: 0.9,
        clearcoatRoughness: 0.12,
      });
      const arcMesh = new THREE.Mesh(arcGeo, arcMat);
      arcMesh.castShadow = !isSoftwareGl;
      vaultCoreGroup.add(arcMesh);
      arcMeshes.push({ mesh: arcMesh, dir: cfg.dir });
    }

    // Part 9: Inner Smart Verification Monolith (Procedural 9HR Seal Card)
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const sealTex = create9HRSealTexture(maxAniso);

    const cardShape = new THREE.Shape();
    const cw = 0.62;
    const ch = 0.82;
    const cr = 0.08;
    cardShape.moveTo(-cw + cr, -ch);
    cardShape.lineTo(cw - cr, -ch);
    cardShape.quadraticCurveTo(cw, -ch, cw, -ch + cr);
    cardShape.lineTo(cw, ch - cr);
    cardShape.quadraticCurveTo(cw, ch, cw - cr, ch);
    cardShape.lineTo(-cw + cr, ch);
    cardShape.quadraticCurveTo(-cw, ch, -cw, ch - cr);
    cardShape.lineTo(-cw, -ch + cr);
    cardShape.quadraticCurveTo(-cw, -ch, -cw + cr, -ch);

    const cardGeo = new THREE.ExtrudeGeometry(cardShape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.018,
      bevelSize: 0.018,
      bevelSegments: 3,
    });
    cardGeo.translate(0, 0, -0.04);

    const cardEdgeMat = new THREE.MeshPhysicalMaterial({
      color: 0x334155,
      metalness: 0.88,
      roughness: 0.22,
    });
    const cardMesh = new THREE.Mesh(cardGeo, cardEdgeMat);
    cardMesh.castShadow = !isSoftwareGl;
    vaultCoreGroup.add(cardMesh);

    const sealFaceMat = new THREE.MeshStandardMaterial({
      map: sealTex,
      roughness: 0.3,
      metalness: 0.15,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const frontFace = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.44), sealFaceMat);
    frontFace.position.z = 0.062;
    cardMesh.add(frontFace);

    const backFace = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.44), sealFaceMat);
    backFace.rotation.y = Math.PI;
    backFace.position.z = -0.062;
    cardMesh.add(backFace);

    // Part 10: Outer Optical Glass Security Shield Plates (front & back split for Exploded View)
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      metalness: 0.0,
      roughness: 0.06,
      transmission: isSoftwareGl ? 0 : 0.88,
      transparent: true,
      opacity: isSoftwareGl ? 0.28 : 1.0,
      ior: 1.52,
      thickness: 0.35,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      depthWrite: false,
    });

    const shieldGeo = new THREE.CylinderGeometry(0.92, 0.92, 0.05, 48);
    shieldGeo.rotateX(Math.PI / 2);

    const frontGlass = new THREE.Mesh(shieldGeo, glassMat);
    frontGlass.position.z = 0.22;
    frontGlass.renderOrder = 3;
    vaultCoreGroup.add(frontGlass);

    const backGlass = new THREE.Mesh(shieldGeo, glassMat);
    backGlass.position.z = -0.22;
    backGlass.renderOrder = 3;
    vaultCoreGroup.add(backGlass);

    // Part 11-12: Tilted Orbital Gyro Rings + 4 Verification Satellite Nodes
    const orbitGroup = new THREE.Group();
    vaultCoreGroup.add(orbitGroup);

    const orbitRingMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.85,
      roughness: 0.25,
    });
    const orbitRing1 = new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.014, 12, 84), orbitRingMat);
    orbitRing1.rotation.set(Math.PI * 0.36, 0.2, 0);
    orbitGroup.add(orbitRing1);

    const orbitRing2 = new THREE.Mesh(new THREE.TorusGeometry(1.64, 0.012, 12, 84), goldMat);
    orbitRing2.rotation.set(-Math.PI * 0.32, -0.35, 0);
    orbitGroup.add(orbitRing2);

    const nodeColors = [0x2563eb, 0x10b981, 0xf59e0b, 0x38bdf8];
    const satelliteNodes: THREE.Group[] = [];
    for (let i = 0; i < 4; i++) {
      const sat = new THREE.Group();
      const angle = (i * Math.PI) / 2;
      sat.position.set(Math.cos(angle) * 1.58, Math.sin(angle) * 0.68, Math.sin(angle) * 1.12);

      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.11, 0),
        new THREE.MeshPhysicalMaterial({
          color: nodeColors[i],
          emissive: nodeColors[i],
          emissiveIntensity: 0.35,
          metalness: 0.4,
          roughness: 0.18,
          clearcoat: 1.0,
        })
      );
      const satRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.16, 0.015, 10, 28),
        gimbalMat
      );
      satRing.rotation.x = Math.PI / 2;
      sat.add(core, satRing);
      orbitGroup.add(sat);
      satelliteNodes.push(sat);
    }

    // Instanced Ambient Node Constellation (60 nodes)
    const particleCount = 60;
    const pGeo = new THREE.OctahedronGeometry(0.032, 0);
    const pMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.65,
      roughness: 0.3,
    });
    const instancedParticles = new THREE.InstancedMesh(pGeo, pMat, particleCount);
    instancedParticles.frustumCulled = false;

    const palette = [0x38bdf8, 0x10b981, 0xf59e0b, 0x64748b];
    for (let i = 0; i < particleCount; i++) {
      const radius = 2.6 + ((i * 37) % 100) * 0.032;
      const theta = i * 2.39996;
      const y = 0.45 + ((i * 53) % 100) * 0.035;
      const scale = 0.6 + ((i * 19) % 10) * 0.08;
      _dummy.position.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
      _dummy.rotation.set(i * 0.4, i * 0.7, 0);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      instancedParticles.setMatrixAt(i, _dummy.matrix);
      _color.setHex(palette[i % palette.length]);
      instancedParticles.setColorAt(i, _color);
    }
    instancedParticles.instanceMatrix.needsUpdate = true;
    if (instancedParticles.instanceColor) instancedParticles.instanceColor.needsUpdate = true;
    instancedParticles.computeBoundingSphere();
    scene.add(instancedParticles);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Resize Observer
    const handleResize = () => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    // Animation Loop with Software-WebGL Pacing & Smooth Damping
    const clock = new THREE.Clock();
    let disposed = false;
    let rafId = 0;
    const timers: number[] = [];

    const registerTimer = (id: number) => {
      timers.push(id);
    };

    const tick = () => {
      if (disposed) return;
      const delta = Math.min(0.1, clock.getDelta());
      const elapsed = clock.elapsedTime;

      const s = stateRef.current;

      // Smoothly damp exploded view separation
      s.explodeCurrent = THREE.MathUtils.damp(s.explodeCurrent, s.explodeTarget, 6.5, delta);
      const ex = s.explodeCurrent;

      frontGlass.position.z = 0.22 + ex * 0.65;
      backGlass.position.z = -0.22 - ex * 0.65;
      gimbalMesh.scale.setScalar(1 + ex * 0.14);
      arcMeshes.forEach(({ mesh, dir }) => {
        mesh.position.set(dir.x * ex * 0.48, dir.y * ex * 0.48, 0);
      });

      // Gentle motion
      if (s.autoSpin) {
        vaultCoreGroup.rotation.y += delta * 0.26;
      }
      orbitGroup.rotation.y -= delta * 0.34;
      orbitGroup.rotation.z = Math.sin(elapsed * 0.5) * 0.08;
      satelliteNodes.forEach((sat, idx) => {
        sat.rotation.y += delta * (0.9 + idx * 0.2);
      });
      instancedParticles.rotation.y += delta * 0.045;

      // Smooth camera preset damping
      if (s.cameraPresetActive) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, s.camPos.x, 5.5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, s.camPos.y, 5.5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, s.camPos.z, 5.5, delta);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, s.camLook.x, 5.5, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, s.camLook.y, 5.5, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, s.camLook.z, 5.5, delta);

        _targetPos.copy(s.camPos);
        _targetLook.copy(s.camLook);
        if (
          camera.position.distanceTo(_targetPos) < 0.02 &&
          controls.target.distanceTo(_targetLook) < 0.02
        ) {
          s.cameraPresetActive = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        waitForSoftwareDraw(renderer, registerTimer, tick);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      waitForSoftwareDraw(renderer, registerTimer, tick);
    } else {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      timers.forEach((id) => window.clearTimeout(id));
      ro.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      envTexture.dispose();
      disposeObjectTree(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full min-h-[380px] lg:min-h-screen bg-[#071222] overflow-hidden select-none">
      {/* Dedicated WebGL Mount Container (sibling to React HUD) */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Top Brand Header Overlay (minimal, zero occlusion of center) */}
      <div className="pointer-events-none absolute top-5 left-5 right-5 flex items-center justify-between gap-4 z-10">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-white p-0.5 flex items-center justify-center shrink-0 overflow-hidden shadow-md">
            <img
              src="/assets/aistudio/image_0ecd2493.png"
              alt="9HR India Pvt. Ltd. Logo"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <span className="font-display text-lg font-bold text-white tracking-tight block leading-tight">
              9HR India Pvt. Ltd.
            </span>
            <span className="text-xs text-slate-300 block">
              3D Onboarding Security Vault
            </span>
          </div>
        </div>
        <span className="text-[11px] font-mono text-emerald-300 px-2.5 py-1 rounded-md bg-[#0B192C]/90 border border-emerald-500/30">
          RBAC · TOTP 2FA
        </span>
      </div>

      {/* Collapsible Unified Bottom Control Dock (Zero Side Clutter, No backdrop-filter) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[540px] z-10 flex flex-col items-center">
        <button
          type="button"
          onClick={() => setHudCollapsed((v) => !v)}
          className="mb-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-t-lg text-[11px] font-semibold text-slate-200 bg-[#0B192C]/95 border border-white/15 hover:bg-[#132946] cursor-pointer"
        >
          {hudCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show 3D Controls
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Hide 3D Controls
            </>
          )}
        </button>

        {!hudCollapsed && (
          <div className="w-full rounded-xl bg-[#0B192C]/95 border border-white/15 p-3 shadow-xl space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                      preset === key
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white/8 text-slate-300 hover:bg-white/15'
                    }`}
                  >
                    {CAMERA_PRESETS[key].label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAutoSpin((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer ${
                  autoSpin
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                    : 'bg-white/8 text-slate-300'
                }`}
              >
                <RotateCcw className="w-3 h-3" />
                {autoSpin ? 'Auto-Orbit On' : 'Paused'}
              </button>
            </div>

            <div className="flex items-center gap-3 pt-1 border-t border-white/10">
              <label
                htmlFor="vault-explode-slider"
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-300 shrink-0"
              >
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Explode Layers
              </label>
              <input
                id="vault-explode-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={explode}
                onChange={(e) => setExplode(Number(e.target.value))}
                className="flex-1 accent-emerald-500 cursor-pointer"
              />
              <span className="font-mono text-[11px] text-slate-300 w-9 text-right">
                {Math.round(explode * 100)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
