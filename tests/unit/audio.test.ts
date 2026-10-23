// Captions get audio in the shape the recogniser needs, and only real speech becomes a caption.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audible, isCaption, resample, samplesOf } from '../../src/domain/audio.ts';

test('48 kHz audio becomes 16 kHz with the same shape', () => {
  const ramp = Float32Array.from({ length: 48 }, (_, i) => i);
  const out = resample(ramp, 48000, 16000);
  assert.equal(out.length, 16);
  assert.deepEqual([...out.slice(0, 3)], [0, 3, 6]);
});

test('samples sent as base64 bytes or as numbers read the same', () => {
  const f = Float32Array.from([0.5, -0.25]);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(f.buffer)));
  assert.deepEqual([...samplesOf(b64)], [0.5, -0.25]);
  assert.deepEqual([...samplesOf([0.5, -0.25])], [0.5, -0.25]);
});

test('silence and sound markers are not captions', () => {
  assert.equal(audible(new Float32Array(100)), false);
  assert.equal(isCaption('[Music]'), false);
  assert.equal(isCaption('(applause)'), false);
  assert.equal(isCaption('Hello there'), true);
});
