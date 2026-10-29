// The FLUX schedule matches diffusers (values from diffusers' compute_empirical_mu and the exponential time shift).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empiricalMu, fluxSigmas } from '../../src/domain/imagegen.ts';
import { parseSettings } from '../../src/domain/settings.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('mu and sigmas for 512² (1024 tokens), 4 steps', () => {
  close(empiricalMu(1024, 4), 2.0306897079499455);
  const want = [1, 0.958085371628187, 0.8839818317017591, 0.7174965587003479, 0];
  fluxSigmas(4, 1024).forEach((s, i) => close(s, want[i]!));
});

test('image and depth model picks: known ids kept, others fall back', () => {
  assert.equal(parseSettings({ imageModel: 'flux', depthModel: 'base' }).imageModel, 'flux');
  assert.equal(parseSettings({ imageModel: 'dalle' }).imageModel, 'janus');
  assert.equal(parseSettings({ depthModel: 7 }).depthModel, 'small');
});
