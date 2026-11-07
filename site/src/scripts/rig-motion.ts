import type { Group, Vector3 } from 'three';
import type { ProjectKey } from './studio-data';

const FLIGHT_MS = 1100;
const BEZIER_STEPS = 14;
const PROJECT_ANGLES = { expo: -0.18, web: 0.12, api: -0.35, swift: 0.28 } as const;

function easeOut(progress: number): number {
  let low = 0,
    high = 1;
  for (let index = 0; index < BEZIER_STEPS; index++) {
    const value = (low + high) / 2,
      inverse = 1 - value;
    const x =
      3 * inverse * inverse * value * 0.23 + 3 * inverse * value * value * 0.32 + value ** 3;
    if (x < progress) low = value;
    else high = value;
  }
  return 1 - (1 - (low + high) / 2) ** 3;
}

export class RigMotion {
  private frame = 0;
  private startTime = 0;
  private moving = false;
  private destroyed = false;
  private expanded = false;
  private yaw: number;
  private startYaw: number;
  private starts: Vector3[];
  private targets: Vector3[];
  isVisible = true;

  constructor(
    private rig: Group,
    private modules: Group[],
    private host: HTMLElement,
    private draw: () => void,
    private reduced: () => boolean,
    private slots: readonly (readonly [number, number, number])[],
  ) {
    this.yaw = this.startYaw = rig.rotation.y;
    this.starts = modules.map((module) => module.position.clone());
    this.targets = this.starts.map((position) => position.clone());
  }

  private updateTargets(): void {
    this.slots.forEach((slot, index) => {
      this.targets[index]!.set(
        slot[0] * (this.expanded ? 1.12 : 1),
        this.expanded ? 1.62 + index * 0.13 : slot[1],
        slot[2] * (this.expanded ? 1.12 : 1),
      );
    });
  }

  private finish(): void {
    this.modules.forEach((module, index) => {
      module.position.copy(this.targets[index]!);
    });
    this.rig.rotation.y = this.yaw;
    this.moving = false;
    this.host.dataset.moving = 'false';
    this.draw();
  }

  private tick = (time: number): void => {
    this.frame = 0;
    if (this.destroyed || !this.isVisible) return;
    const progress = Math.min(1, (time - this.startTime) / FLIGHT_MS),
      eased = easeOut(progress);
    this.modules.forEach((module, index) => {
      module.position.lerpVectors(this.starts[index]!, this.targets[index]!, eased);
    });
    this.rig.rotation.y = this.startYaw + (this.yaw - this.startYaw) * eased;
    this.draw();
    if (progress < 1) this.frame = requestAnimationFrame(this.tick);
    else this.finish();
  };

  private transition(animate: boolean): void {
    cancelAnimationFrame(this.frame);
    this.starts = this.modules.map((module) => module.position.clone());
    this.startYaw = this.rig.rotation.y;
    if (!animate || this.reduced()) {
      this.finish();
      return;
    }
    this.moving = true;
    this.host.dataset.moving = 'true';
    this.startTime = performance.now();
    if (this.isVisible) this.frame = requestAnimationFrame(this.tick);
  }

  project(key: ProjectKey, animate: boolean): void {
    this.yaw = PROJECT_ANGLES[key];
    this.expanded = false;
    this.updateTargets();
    this.transition(animate);
  }

  explode(value: boolean, animate: boolean): void {
    this.expanded = value;
    this.updateTargets();
    this.transition(animate);
  }

  rotate(animate: boolean): void {
    this.yaw += Math.PI / 2;
    this.transition(animate);
  }

  drag(delta: number): void {
    this.yaw += delta;
    this.startYaw += delta;
    this.rig.rotation.y += delta;
    this.draw();
  }

  visible(value: boolean): void {
    this.isVisible = value;
    cancelAnimationFrame(this.frame);
    if (value) {
      if (this.moving) this.transition(!this.reduced());
      else this.draw();
    }
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.finish();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.host.dataset.moving = 'false';
  }
}
