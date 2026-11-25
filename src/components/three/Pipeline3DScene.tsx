import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import {
  AnalyticsSummary,
  ONBOARDING_STATUSES,
  OnboardingStatus,
  StaffRole,
} from '../../shared/types.ts';
import {
  createContactShadowTexture,
  createFloorGridTexture,
  createStudioRenderer,
  detectSoftwareWebGL,
  disposeObjectTree,
  setupStudioEnvironment,
  waitForSoftwareDraw,
} from './threeUtils.ts';

interface StageAuthorityMeta {
  status: OnboardingStatus;
  color: number;
  hex: string;
  authority: string;
  description: string;
}

const STAGE_META: StageAuthorityMeta[] = [
  {
    status: 'Draft',
    color: 0x64748b,
    hex: '#64748B',
    authority: 'HR · Admin · Super Admin',
    description: 'Profile drafted before onboarding token dispatch.',
  },
  {
    status: 'Link Sent',
    color: 0x0284c7,
    hex: '#0284C7',
    authority: 'HR · Admin · Super Admin',
    description: 'Expiring 256-bit cryptographic URL generated and queued.',
  },
  {
    status: 'In Progress',
    color: 0x2563eb,
    hex: '#2563EB',
    authority: 'Candidate (Token) · HR Tracked',
    description: 'Candidate completing 8-step form with autosave.',
  },
  {
    status: 'Submitted',
    color: 0x0ea5e9,
    hex: '#0EA5E9',
    authority: 'HR · Admin · Super Admin',
    description: 'Candidate signed declaration; awaiting HR verification.',
  },
  {
    status: 'Under Review',
    color: 0x6366f1,
    hex: '#6366F1',
    authority: 'HR · Admin · Super Admin',
    description: 'HR reviewing identity, banking, and employment records.',
  },
  {
    status: 'Documents Pending',
    color: 0xd97706,
    hex: '#D97706',
    authority: 'HR · Candidate Re-upload',
    description: 'Mandatory compliance documents pending upload/verification.',
  },
  {
    status: 'Correction Required',
    color: 0xf59e0b,
    hex: '#F59E0B',
    authority: 'HR · Candidate Resubmit',
    description: 'Link unlocked for candidate to fix flagged entries or files.',
  },
  {
    status: 'Approved',
    color: 0x10b981,
    hex: '#10B981',
    authority: 'Admin · Super Admin Only',
    description: 'Final compliance approval granted by Admin or Super Admin.',
  },
  {
    status: 'Onboarding Completed',
    color: 0x059669,
    hex: '#059669',
    authority: 'Admin · Super Admin Only',
    description: 'Converted into official 9HR-EMP-YYYY-XXXX employee record.',
  },
  {
    status: 'Rejected',
    color: 0xdc2626,
    hex: '#DC2626',
    authority: 'Admin · Super Admin Only',
    description: 'Application closed/rejected with immutable audit entry.',
  },
];

type ViewPreset = 'arc' | 'top' | 'authority';

const PRESETS: Record<
  ViewPreset,
  { pos: [number, number, number]; target: [number, number, number]; label: string }
> = {
  arc: { pos: [0, 6.2, 10.6], target: [0, 1.1, 0], label: 'Pipeline Arc' },
  top: { pos: [0, 11.5, 4.2], target: [0, 0.5, -0.4], label: 'Overhead Matrix' },
  authority: { pos: [0, 3.6, 5.4], target: [0, 1.5, 0], label: 'Authority Core' },
};

const _vecTarget = new THREE.Vector3();
const _vecLook = new THREE.Vector3();
const _mouse = new THREE.Vector2();

export function Pipeline3DScene({
  analytics,
  userRole,
}: {
  analytics: AnalyticsSummary;
  userRole?: StaffRole;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const stageCounts = useMemo(() => {
    const map = new Map<OnboardingStatus, number>();
    for (const s of ONBOARDING_STATUSES) map.set(s, 0);
    for (const item of analytics.statusDistribution) {
      map.set(item.status as OnboardingStatus, item.count);
    }
    return map;
  }, [analytics.statusDistribution]);

  const [selectedStage, setSelectedStage] = useState<OnboardingStatus>('Onboarding Completed');
  const [preset, setPreset] = useState<ViewPreset>('arc');
  const [hudCollapsed, setHudCollapsed] = useState<boolean>(false);

  const stateRef = useRef({
    counts: STAGE_META.map((m) => stageCounts.get(m.status) || 0),
    selectedIdx: STAGE_META.findIndex((m) => m.status === 'Onboarding Completed'),
    cameraPresetActive: false,
    camPos: new THREE.Vector3(...PRESETS.arc.pos),
    camLook: new THREE.Vector3(...PRESETS.arc.target),
  });

  useEffect(() => {
    stateRef.current.counts = STAGE_META.map((m) => stageCounts.get(m.status) || 0);
  }, [stageCounts]);

  const applyPreset = (next: ViewPreset) => {
    setPreset(next);
    const p = PRESETS[next];
    stateRef.current.camPos.set(...p.pos);
    stateRef.current.camLook.set(...p.target);
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
    scene.fog = new THREE.FogExp2(bgHex, 0.026);

    const envTexture = setupStudioEnvironment(scene, renderer);

    const camera = new THREE.PerspectiveCamera(
      42,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      90
    );
    camera.position.set(...PRESETS.arc.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...PRESETS.arc.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 4.0;
    controls.maxDistance = 18.0;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.update();

    const onControlStart = () => {
      stateRef.current.cameraPresetActive = false;
    };
    controls.addEventListener('start', onControlStart);

    // Warm/Cool 3-Point Lighting
    scene.add(new THREE.HemisphereLight(0x93c5fd, 0x0b192c, 0.8));

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.2);
    keyLight.position.set(7, 11, 8);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 32;
      const d = 8.5;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x10b981, 1.4);
    rimLight.position.set(-7, 5, -6);
    scene.add(rimLight);

    // Coordinate Grid Floor (polygonOffset prevents z-fighting)
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const gridTex = createFloorGridTexture(maxAniso);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(18, 64),
      new THREE.MeshStandardMaterial({
        map: gridTex,
        roughness: 0.72,
        metalness: 0.25,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = !isSoftwareGl;
    scene.add(floor);

    const shadowTex = createContactShadowTexture();
    const centerShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 5.2),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
      })
    );
    centerShadow.rotation.x = -Math.PI / 2;
    centerShadow.position.y = 0.02;
    scene.add(centerShadow);

    // -------------------------------------------------------------------------
    // Center Authority Hierarchy Core (4 RBAC Tiers: Composite Group)
    // -------------------------------------------------------------------------
    const authorityCore = new THREE.Group();
    scene.add(authorityCore);

    const corePedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.65, 0.22, 36),
      new THREE.MeshStandardMaterial({ color: 0x0f1f36, roughness: 0.55, metalness: 0.45 })
    );
    corePedestal.position.y = 0.11;
    corePedestal.receiveShadow = !isSoftwareGl;
    corePedestal.castShadow = !isSoftwareGl;
    authorityCore.add(corePedestal);

    const tierConfigs: Array<{
      roleLabel: string;
      radius: number;
      y: number;
      color: number;
      active: boolean;
    }> = [
      { roleLabel: 'CANDIDATE', radius: 1.25, y: 0.65, color: 0x38bdf8, active: false },
      { roleLabel: 'HR', radius: 1.0, y: 1.22, color: 0xd97706, active: userRole === 'HR' },
      { roleLabel: 'ADMIN', radius: 0.75, y: 1.82, color: 0x2563eb, active: userRole === 'ADMIN' },
      { roleLabel: 'SUPER_ADMIN', radius: 0.48, y: 2.45, color: 0x10b981, active: userRole === 'SUPER_ADMIN' },
    ];

    const tierRings: THREE.Mesh[] = [];
    for (const tier of tierConfigs) {
      const discMat = new THREE.MeshPhysicalMaterial({
        color: tier.color,
        emissive: tier.color,
        emissiveIntensity: tier.active ? 0.55 : 0.14,
        metalness: 0.45,
        roughness: 0.22,
        clearcoat: 0.9,
      });
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(tier.radius, tier.radius * 1.06, 0.12, 32),
        discMat
      );
      disc.position.y = tier.y;
      disc.castShadow = !isSoftwareGl;
      authorityCore.add(disc);

      const trim = new THREE.Mesh(
        new THREE.TorusGeometry(tier.radius + 0.04, 0.022, 12, 48),
        new THREE.MeshStandardMaterial({
          color: tier.active ? 0xfef08a : 0xcbd5e1,
          metalness: 0.9,
          roughness: 0.2,
        })
      );
      trim.rotation.x = Math.PI / 2;
      trim.position.y = tier.y;
      authorityCore.add(trim);
      tierRings.push(trim);
    }

    // Central spine crystal
    const spine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.14, 2.7, 16),
      new THREE.MeshPhysicalMaterial({
        color: 0xe2e8f0,
        metalness: 0.85,
        roughness: 0.18,
      })
    );
    spine.position.y = 1.4;
    authorityCore.add(spine);

    // -------------------------------------------------------------------------
    // 10 Onboarding Stage Composite Pillars in an Architectural Arc
    // -------------------------------------------------------------------------
    const pillars: Array<{
      group: THREE.Group;
      column: THREE.Mesh;
      cap: THREE.Group;
      halo: THREE.Mesh;
      currentScaleY: number;
      collider: THREE.Mesh;
    }> = [];

    const clickables: THREE.Object3D[] = [];
    const arcRadius = 4.6;
    const totalStages = STAGE_META.length;

    STAGE_META.forEach((meta, idx) => {
      const t = idx / (totalStages - 1);
      const angle = THREE.MathUtils.lerp(-Math.PI * 0.82, -Math.PI * 0.18, t) + Math.PI;
      const x = Math.cos(angle) * arcRadius;
      const z = Math.sin(angle) * arcRadius * 0.92;

      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.lookAt(0, 0, 0);
      scene.add(group);

      // Part 1: Hexagonal Plinth Base (flush on y = 0)
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.46, 0.54, 0.16, 6),
        new THREE.MeshStandardMaterial({ color: 0x0f1f36, roughness: 0.6, metalness: 0.4 })
      );
      base.position.y = 0.08;
      base.castShadow = !isSoftwareGl;
      base.receiveShadow = !isSoftwareGl;
      group.add(base);

      // Part 2: Metallic Collar
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.37, 0.42, 0.08, 24),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.88, roughness: 0.24 })
      );
      collar.position.y = 0.2;
      group.add(collar);

      // Part 3: Status-Scaled Tower Column (pivot at bottom)
      const colGeo = new THREE.CylinderGeometry(0.3, 0.34, 1, 24);
      colGeo.translate(0, 0.5, 0);
      const colMat = new THREE.MeshPhysicalMaterial({
        color: meta.color,
        emissive: meta.color,
        emissiveIntensity: 0.18,
        metalness: 0.35,
        roughness: 0.25,
        clearcoat: 0.85,
      });
      const column = new THREE.Mesh(colGeo, colMat);
      column.position.y = 0.24;
      column.castShadow = !isSoftwareGl;
      column.receiveShadow = !isSoftwareGl;
      group.add(column);

      // Part 4: Cap & Selection Halo
      const cap = new THREE.Group();
      cap.position.y = 0.74;
      const capDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.3, 0.09, 24),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.2 })
      );
      const beacon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.11, 0),
        new THREE.MeshStandardMaterial({
          color: meta.color,
          emissive: meta.color,
          emissiveIntensity: 0.65,
          roughness: 0.2,
          metalness: 0.3,
        })
      );
      beacon.position.y = 0.18;
      cap.add(capDisc, beacon);
      group.add(cap);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.56, 0.66, 32),
        new THREE.MeshBasicMaterial({
          color: meta.color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0,
        })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.03;
      group.add(halo);

      // Dedicated Invisible Layer-1 Proxy Collider for Fast Raycasting
      const collider = new THREE.Mesh(
        new THREE.CylinderGeometry(0.56, 0.56, 3.6, 8),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      collider.position.y = 1.8;
      collider.layers.set(1);
      collider.userData.stageIndex = idx;
      group.add(collider);
      clickables.push(collider);

      pillars.push({
        group,
        column,
        cap,
        halo,
        currentScaleY: 0.4,
        collider,
      });
    });

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Raycasting on Layer 1
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    let lastHoverCheck = 0;

    const updatePointer = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      _mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerDown = (ev: PointerEvent) => {
      updatePointer(ev);
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(clickables, false);
      if (hits.length > 0) {
        const idx = hits[0].object.userData.stageIndex as number;
        if (typeof idx === 'number' && STAGE_META[idx]) {
          stateRef.current.selectedIdx = idx;
          setSelectedStage(STAGE_META[idx].status);
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const now = Date.now();
      if (now - lastHoverCheck < 60) return;
      lastHoverCheck = now;
      updatePointer(ev);
      raycaster.setFromCamera(_mouse, camera);
      const hits = raycaster.intersectObjects(clickables, false);
      renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

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

    const clock = new THREE.Clock();
    let disposed = false;
    let rafId = 0;
    const timers: number[] = [];
    const registerTimer = (id: number) => timers.push(id);

    const tick = () => {
      if (disposed) return;
      const delta = Math.min(0.1, clock.getDelta());
      const s = stateRef.current;
      const maxCount = Math.max(1, ...s.counts);

      pillars.forEach((p, idx) => {
        const count = s.counts[idx] || 0;
        const targetH = 0.35 + (count / maxCount) * 2.75;
        p.currentScaleY = THREE.MathUtils.damp(p.currentScaleY, targetH, 6.0, delta);
        p.column.scale.y = p.currentScaleY;
        p.cap.position.y = 0.24 + p.currentScaleY + 0.04;
        p.cap.rotation.y += delta * 0.6;

        const isSelected = s.selectedIdx === idx;
        const haloMat = p.halo.material as THREE.MeshBasicMaterial;
        haloMat.opacity = THREE.MathUtils.damp(haloMat.opacity, isSelected ? 0.92 : 0.0, 8.0, delta);
        const colMat = p.column.material as THREE.MeshPhysicalMaterial;
        colMat.emissiveIntensity = THREE.MathUtils.damp(
          colMat.emissiveIntensity,
          isSelected ? 0.48 : 0.16,
          8.0,
          delta
        );
      });

      tierRings.forEach((ring, i) => {
        ring.rotation.z += delta * (0.25 + i * 0.1);
      });

      if (s.cameraPresetActive) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, s.camPos.x, 5.5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, s.camPos.y, 5.5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, s.camPos.z, 5.5, delta);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, s.camLook.x, 5.5, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, s.camLook.y, 5.5, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, s.camLook.z, 5.5, delta);

        _vecTarget.copy(s.camPos);
        _vecLook.copy(s.camLook);
        if (
          camera.position.distanceTo(_vecTarget) < 0.02 &&
          controls.target.distanceTo(_vecLook) < 0.02
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
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      envTexture.dispose();
      disposeObjectTree(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [userRole]);

  const activeMeta = STAGE_META.find((m) => m.status === selectedStage) || STAGE_META[0];
  const activeCount = stageCounts.get(activeMeta.status) || 0;
  const totalCandidates = Math.max(1, analytics.kpis.totalCandidates);
  const sharePct = Math.round((activeCount / totalCandidates) * 100);

  return (
    <div className="relative w-full h-[540px] sm:h-[600px] bg-[#071222] rounded-xl border border-slate-800 overflow-hidden select-none">
      {/* Dedicated WebGL Mount Container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Minimal Top Badge */}
      <div className="pointer-events-none absolute top-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2 z-10">
        <div className="px-3 py-1.5 rounded-lg bg-[#0B192C]/92 border border-white/12">
          <p className="text-xs font-bold text-white">
            3D Onboarding Pipeline &amp; Authority Matrix
          </p>
          <p className="text-[11px] text-slate-300">
            Click any stage pillar to inspect count and authorized roles · Drag to orbit
          </p>
        </div>
        <div className="px-3 py-1.5 rounded-lg bg-[#0B192C]/92 border border-emerald-500/30 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Active Tier: {userRole ? userRole.replace('_', ' ') : 'STAFF'}</span>
        </div>
      </div>

      {/* Collapsible Unified Bottom Control Dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-[820px] z-10 flex flex-col items-center">
        <button
          type="button"
          onClick={() => setHudCollapsed((v) => !v)}
          className="mb-1 inline-flex items-center gap-1.5 px-3 py-1 rounded-t-lg text-[11px] font-semibold text-slate-200 bg-[#0B192C]/95 border border-white/15 hover:bg-[#132946] cursor-pointer"
        >
          {hudCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show Stage Inspector
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Hide Stage Inspector
            </>
          )}
        </button>

        {!hudCollapsed && (
          <div className="w-full rounded-xl bg-[#0B192C]/95 border border-white/15 p-3.5 shadow-xl space-y-3">
            {/* Selected Stage Readout + Camera Presets */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-3 h-8 rounded-sm shrink-0"
                  style={{ backgroundColor: activeMeta.hex }}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs sm:text-sm font-bold text-white">
                      {activeMeta.status}
                    </span>
                    <span className="font-mono text-xs font-bold text-emerald-300">
                      {activeCount} candidates ({sharePct}%)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 truncate">
                    <strong className="text-sky-300">Authority:</strong> {activeMeta.authority} ·{' '}
                    {activeMeta.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {(Object.keys(PRESETS) as ViewPreset[]).map((key) => (
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
                    {PRESETS[key].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Stage Selector Strip */}
            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-white/10">
              {STAGE_META.map((meta, idx) => {
                const cnt = stageCounts.get(meta.status) || 0;
                const active = meta.status === activeMeta.status;
                return (
                  <button
                    key={meta.status}
                    type="button"
                    onClick={() => {
                      stateRef.current.selectedIdx = idx;
                      setSelectedStage(meta.status);
                    }}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                      active
                        ? 'bg-white text-slate-900 font-semibold'
                        : 'bg-white/8 text-slate-300 hover:bg-white/15'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-xs shrink-0"
                      style={{ backgroundColor: meta.hex }}
                    />
                    <span>{meta.status}</span>
                    <span className="font-mono opacity-80">{cnt}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
