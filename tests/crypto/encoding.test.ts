import { describe, it, expect } from 'vitest';
import { toBase64, fromBase64, generateSalt } from '@/lib/crypto/vault';

describe('encoding', () => {
  it('round-trips bytes through base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual([0, 1, 2, 254, 255]);
  });
  it('generates a 16-byte salt as base64', () => {
    const salt = generateSalt();
    expect(fromBase64(salt).length).toBe(16);
  });
  it('generates unique salts', () => {
    expect(generateSalt()).not.toBe(generateSalt());
  });
});
