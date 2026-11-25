import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Detect software WebGL renderers (SwiftShader, llvmpipe, WARP) via GPU renderer string.
 * Used strictly to scale rendering cost (pixelRatio, shadows, transmission, frame pacing)
 * while preserving identical scene geometry, layout, and logic across devices.
 */
export function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function createStudioRenderer(
  container: HTMLElement,
  isSoftwareGl: boolean
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(
    Math.max(1, container.clientWidth),
    Math.max(1, container.clientHeight)
  );
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);
  return renderer;
}

export function setupStudioEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();
  return envTex;
}

/**
 * Software-WebGL fence pacing to avoid starving the browser main thread.
 */
export function waitForSoftwareDraw(
  renderer: THREE.WebGLRenderer,
  registerTimer: (id: number) => void,
  cb: () => void
): void {
  const gl = renderer.getContext() as WebGL2RenderingContext | null;
  if (!gl || typeof gl.fenceSync !== 'function') {
    const id = window.setTimeout(cb, 80);
    registerTimer(id);
    return;
  }
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  const poll = () => {
    const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
    if (status === gl.UNSIGNALED) {
      const id = window.setTimeout(poll, 5);
      registerTimer(id);
    } else {
      if (sync) gl.deleteSync(sync);
      const id = window.setTimeout(cb, 80);
      registerTimer(id);
    }
  };
  const id = window.setTimeout(poll, 5);
  registerTimer(id);
}

/**
 * Procedural soft radial contact shadow texture for grounded models.
 */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.06,
    size / 2,
    size / 2,
    size * 0.5
  );
  grad.addColorStop(0, 'rgba(2, 6, 23, 0.72)');
  grad.addColorStop(0.45, 'rgba(2, 6, 23, 0.34)');
  grad.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedural 9HR India security emblem core card texture (no credentials, clean brand seal).
 */
export function create9HRSealTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 512;
  const h = 640;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Deep executive navy base
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#071120');
  bg.addColorStop(0.5, '#0B192C');
  bg.addColorStop(1, '#102542');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle architectural grid
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 32; x < w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 32; y < h; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Outer precision border
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, w - 48, h - 48);

  // 4-color 9HR India ring seal
  const cx = w / 2;
  const cy = 240;
  const r = 104;
  const arcs: Array<[number, number, string]> = [
    [-Math.PI * 0.95, -Math.PI * 0.45, '#2563EB'], // Cobalt Blue
    [-Math.PI * 0.42, Math.PI * 0.08, '#0F172A'], // Deep Slate
    [Math.PI * 0.12, Math.PI * 0.58, '#F59E0B'], // Amber Gold
    [Math.PI * 0.62, Math.PI * 1.02, '#059669'], // Emerald
  ];
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  for (const [start, end, color] of arcs) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.arc(cx, cy, r, start, end);
    ctx.stroke();
  }

  // Inner circle
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 18, 0, Math.PI * 2);
  ctx.fill();

  // "9HR" crisp emblem typography
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 72px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#1D4ED8';
  ctx.fillText('9', cx - 44, cy - 4);
  ctx.fillStyle = '#0F172A';
  ctx.fillText('H', cx + 4, cy - 4);
  ctx.fillStyle = '#059669';
  ctx.fillText('R', cx + 52, cy - 4);

  // Four brand dots
  const dotColors = ['#1D4ED8', '#0F172A', '#F59E0B', '#059669'];
  dotColors.forEach((c, idx) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(cx - 27 + idx * 18, cy + 44, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Lower certification strip
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillText('9HR INDIA PVT. LTD.', cx, 420);

  ctx.fillStyle = '#34D399';
  ctx.font = '600 15px ui-monospace, monospace';
  ctx.fillText('RBAC · TOTP 2FA · ENCRYPTED VAULT', cx, 462);

  // Verification seal bars
  const bars = [0.78, 0.92, 0.65, 0.88];
  bars.forEach((ratio, i) => {
    const by = 510 + i * 20;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(96, by, w - 192, 8);
    ctx.fillStyle = i % 2 === 0 ? '#10B981' : '#38BDF8';
    ctx.fillRect(96, by, (w - 192) * ratio, 8);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.max(1, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedural coordinate grid floor texture for 3D pipeline platform.
 */
export function createFloorGridTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#091426';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
  ctx.lineWidth = 1;
  const step = 32;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(16, 185, 129, 0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.max(1, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Dispose all geometries, materials, and textures within a Three.js Object3D subtree.
 */
export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.map) std.map.dispose();
        if (std.normalMap) std.normalMap.dispose();
        if (std.roughnessMap) std.roughnessMap.dispose();
        if (std.metalnessMap) std.metalnessMap.dispose();
        m.dispose();
      }
    }
  });
}
