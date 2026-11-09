import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Group } from 'three';
import { RigMotion } from '../src/scripts/rig-motion';

let now = 0,
  sequence = 0;
const callbacks = new Map<number, FrameRequestCallback>();
const originalRequest = globalThis.requestAnimationFrame,
  originalCancel = globalThis.cancelAnimationFrame;
let clock: ReturnType<typeof spyOn>;
beforeEach(() => {
  now = 0;
  sequence = 0;
  callbacks.clear();
  clock = spyOn(performance, 'now').mockImplementation(() => now);
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.set(++sequence, callback);
    return sequence;
  };
  globalThis.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
  };
});
afterEach(() => {
  clock.mockRestore();
  if (originalRequest) globalThis.requestAnimationFrame = originalRequest;
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  if (originalCancel) globalThis.cancelAnimationFrame = originalCancel;
  else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
});
function advance(time: number): void {
  now = time;
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(time);
}
function fixture() {
  const rig = new Group(),
    modules = [new Group(), new Group(), new Group(), new Group()];
  const host = { dataset: { moving: 'false' } };
  let draws = 0;
  const motion = new RigMotion(
    rig,
    modules,
    host,
    () => {
      draws++;
    },
    () => false,
    [
      [-1, 0.7, -1],
      [1, 0.7, -1],
      [-1, 0.7, 1],
      [1, 0.7, 1],
    ],
  );
  return { motion, rig, modules, host, draws: () => draws };
}
test('project changes take the short rotation path after repeated quarter turns', () => {
  const { motion, rig, host } = fixture();
  rig.rotation.y = Math.PI * 4 + 0.4;
  const start = rig.rotation.y;
  motion.project('expo', true);
  advance(1200);
  expect(Math.abs(rig.rotation.y - start)).toBeLessThan(Math.PI);
  expect(host.dataset.moving).toBe('false');
  motion.destroy();
});
test('repeated visibility notifications do not restart a running transition', () => {
  const { motion, host } = fixture();
  motion.explode(true, true);
  advance(400);
  motion.visible(true);
  advance(1200);
  expect(host.dataset.moving).toBe('false');
  expect(callbacks.size).toBe(0);
  motion.destroy();
});
test('overlay pauses preserve the remaining transition time instead of restarting it', () => {
  const { motion, host, draws } = fixture();
  motion.explode(true, true);
  advance(400);
  motion.visible(false);
  const pausedDraws = draws();
  advance(10000);
  expect(draws()).toBe(pausedDraws);
  motion.visible(true);
  advance(10800);
  expect(host.dataset.moving).toBe('false');
  expect(callbacks.size).toBe(0);
  motion.destroy();
});
test('drag input draws once per frame and destruction cancels the final queued draw', () => {
  const { motion, rig, draws } = fixture();
  for (let input = 0; input < 20; input++) motion.drag(0.05);
  expect(draws()).toBe(0);
  expect(callbacks.size).toBe(1);
  advance(16);
  expect(draws()).toBe(1);
  expect(rig.rotation.y).toBeCloseTo(1);
  motion.drag(0.1);
  motion.destroy();
  advance(32);
  expect(draws()).toBe(1);
  expect(callbacks.size).toBe(0);
});
