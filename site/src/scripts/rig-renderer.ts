import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RigMotion } from './rig-motion';
import type { ProjectKey } from './studio-data';

const MAX_PIXEL_RATIO = 2;
const VIEW_WIDTH = 8.8;
const slots = [
  [-1.05, 0.72, -0.88],
  [1.05, 0.72, -0.88],
  [-1.05, 0.72, 1.0],
  [1.05, 0.72, 1.0],
] as const;
export type RigController = {
  project: (key: ProjectKey, animate: boolean) => void;
  explode: (value: boolean, animate: boolean) => void;
  rotate: (animate: boolean) => void;
  visible: (value: boolean) => void;
  stopMotion: () => void;
  destroy: () => void;
};

function labelTexture(symbol: string, dark = false): CanvasTexture {
  const surface = document.createElement('canvas');
  surface.width = surface.height = 512;
  const context = surface.getContext('2d');
  if (context) {
    context.fillStyle = dark ? '#f6ecdc' : '#20211f';
    context.font = '500 300px Instrument, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(symbol, 256, 270);
    context.lineWidth = 7;
    context.strokeStyle = dark ? '#b8ac96' : '#54544c';
    context.beginPath();
    context.moveTo(50, 130);
    context.lineTo(50, 50);
    context.lineTo(130, 50);
    context.moveTo(382, 462);
    context.lineTo(462, 462);
    context.lineTo(462, 382);
    context.stroke();
  }
  const texture = new CanvasTexture(surface);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function rounded(
  parent: Group,
  dimensions: [number, number, number],
  material: MeshStandardMaterial,
  position: [number, number, number],
): Mesh {
  const shape = new Mesh(new RoundedBoxGeometry(...dimensions, 3, 0.055), material);
  shape.position.set(...position);
  shape.castShadow = true;
  shape.receiveShadow = true;
  parent.add(shape);
  return shape;
}

function topLabel(
  parent: Group,
  texture: CanvasTexture,
  width: number,
  height: number,
  level: number,
): void {
  const face = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = level;
  parent.add(face);
}

function createModule(index: number, textures: CanvasTexture[]): Group {
  const module = new Group();
  const orange = index === 2,
    dark = index === 3;
  const material = new MeshStandardMaterial({
    color: orange ? '#ba4823' : dark ? '#292b2d' : '#a8aba9',
    metalness: orange ? 0.12 : 0.75,
    roughness: 0.42,
  });
  rounded(module, [1.74, 0.55, 1.45], material, [0, 0, 0]);
  rounded(
    module,
    [1.5, 0.07, 1.21],
    new MeshStandardMaterial({
      color: orange ? '#ed703c' : dark ? '#343637' : '#c8cbc7',
      metalness: 0.25,
      roughness: 0.55,
    }),
    [0, 0.3, 0],
  );
  const texture = labelTexture(['S', 'M', 'R', 'A'][index]!, dark);
  textures.push(texture);
  topLabel(module, texture, 1.25, 1.05, 0.341);
  const contact = new MeshStandardMaterial({ color: '#9f9d91', metalness: 0.9, roughness: 0.3 });
  for (let pin = 0; pin < 7; pin++)
    rounded(module, [0.07, 0.11, 0.24], contact, [-0.52 + pin * 0.17, -0.31, 0.6]);
  return module;
}

function createChassis(textures: CanvasTexture[]): {
  rig: Group;
  modules: Group[];
} {
  const rig = new Group();
  const silver = new MeshStandardMaterial({ color: '#999a98', metalness: 0.88, roughness: 0.27 });
  rounded(rig, [5.35, 0.22, 4.45], silver, [0, 0.12, 0]);
  rounded(
    rig,
    [4.97, 0.12, 4.05],
    new MeshStandardMaterial({ color: '#202020', metalness: 0.5, roughness: 0.55 }),
    [0, 0.29, 0],
  );
  for (const side of [-1, 1]) {
    rounded(rig, [0.15, 0.32, 4.45], silver, [side * 2.6, 0.31, 0]);
    rounded(rig, [5.05, 0.17, 0.15], silver, [0, 0.32, side * 2.12]);
    for (const end of [-1, 1]) {
      const bolt = new Mesh(
        new CylinderGeometry(0.075, 0.075, 0.025, 12),
        new MeshStandardMaterial({ color: '#333333', metalness: 0.8, roughness: 0.3 }),
      );
      bolt.position.set(side * 2.6, 0.49, end * 1.83);
      rig.add(bolt);
    }
  }
  const modules = slots.map((position, index) => {
    const module = createModule(index, textures);
    module.position.set(position[0], position[1], position[2]);
    rig.add(module);
    return module;
  });
  const brandMark = labelTexture('R', true);
  textures.push(brandMark);
  const nameplate = new Group();
  nameplate.position.set(0, 0.42, 1.94);
  topLabel(nameplate, brandMark, 0.6, 0.36, 0);
  rig.add(nameplate);
  for (let index = 0; index < 9; index++)
    rounded(
      rig,
      [0.17, 0.04, 0.04],
      new MeshStandardMaterial({ color: index < 4 ? '#f47d48' : '#555551', roughness: 0.8 }),
      [-1.08 + index * 0.26, 0.37, -1.97],
    );
  rig.rotation.y = -0.18;
  return { rig, modules };
}

function createLighting(renderer: WebGLRenderer) {
  const scene = new Scene();
  const room = new RoomEnvironment(),
    environment = new PMREMGenerator(renderer);
  const envMap = environment.fromScene(room, 0.04);
  scene.environment = envMap.texture;
  scene.environmentIntensity = 0.65;
  room.dispose();
  environment.dispose();
  scene.add(new HemisphereLight(0xffffff, 0x232323, 1.6));
  const key = new DirectionalLight(0xfff4e5, 3);
  key.position.set(-4, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.001;
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 1.5);
  fill.position.set(4, 3, -5);
  scene.add(fill);
  const ground = new Mesh(new PlaneGeometry(15, 15), new ShadowMaterial({ opacity: 0.4 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  scene.add(ground);
  return { scene, envMap, key };
}

function bindViewport(
  host: HTMLElement,
  renderer: WebGLRenderer,
  camera: OrthographicCamera,
  draw: () => void,
): () => void {
  const resize = (): void => {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight);
    camera.left = -VIEW_WIDTH / 2;
    camera.right = VIEW_WIDTH / 2;
    camera.top = (VIEW_WIDTH * height) / width / 2;
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  return () => observer.disconnect();
}

function bindPointer(canvas: HTMLCanvasElement, motion: RigMotion): () => void {
  let pointer: { id: number; x: number } | undefined;
  const down = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX };
    canvas.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent): void => {
    if (!pointer || pointer.id !== event.pointerId) return;
    motion.drag((event.clientX - pointer.x) / 180);
    pointer.x = event.clientX;
  };
  const up = (): void => {
    pointer = undefined;
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
  };
}

function disposeScene(scene: Scene, textures: CanvasTexture[]): void {
  const geometries = new Set<Mesh['geometry']>(),
    materials = new Set<Material>();
  scene.traverse((object) => {
    if (object instanceof Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

export async function createRig(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  reduced: () => boolean,
): Promise<RigController> {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const camera = new OrthographicCamera(-4.4, 4.4, 4, -4, 0.1, 70);
  camera.position.set(7.8, 8.3, 10);
  camera.lookAt(0, 0.65, 0);
  const { scene, envMap, key } = createLighting(renderer),
    textures: CanvasTexture[] = [],
    built = createChassis(textures);
  scene.add(built.rig);
  let destroyed = false;
  const draw = (): void => {
    if (!destroyed && motion.isVisible) renderer.render(scene, camera);
  };
  const motion = new RigMotion(built.rig, built.modules, host, draw, reduced, slots);
  const stopViewport = bindViewport(host, renderer, camera, draw),
    stopPointer = bindPointer(canvas, motion);
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    motion.destroy();
    stopViewport();
    stopPointer();
    disposeScene(scene, textures);
    envMap.dispose();
    key.shadow.dispose();
    renderer.dispose();
  };
  try {
    await renderer.compileAsync(scene, camera);
    draw();
  } catch (error) {
    destroy();
    throw error;
  }
  return {
    project: (projectKey, animate) => motion.project(projectKey, animate),
    explode: (value, animate) => motion.explode(value, animate),
    rotate: (animate) => motion.rotate(animate),
    visible: (value) => motion.visible(value),
    stopMotion: () => motion.stop(),
    destroy,
  };
}
