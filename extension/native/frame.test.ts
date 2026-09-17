import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const HOST = path.resolve('scripts/mock-native-host.mjs');

function encodeFrame(payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

function decodeFirst(buf: Buffer): unknown {
  if (buf.length < 4) {
    throw new Error(`stdout terlalu pendek untuk bingkai: ${buf.length} byte`);
  }
  const n = buf.readUInt32LE(0);
  const body = buf.subarray(4, 4 + n);
  if (body.length !== n) {
    throw new Error(`stdout terpotong: diharapkan ${n}, ada ${body.length}`);
  }
  return JSON.parse(body.toString('utf8')) as unknown;
}

function talk(input: Buffer): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
        code,
      });
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

describe('T-02 native host framing without Chrome', () => {
  it('(a) replies to a normal run with a framed outcome', async () => {
    const res = await talk(encodeFrame({ action: 'run', notebook_id: 'nb-t02-a' }));
    expect(res.code).toBe(0);
    const reply = decodeFirst(res.stdout) as {
      type?: string;
      state?: string;
      data?: { notebook_id?: string; echoed?: boolean };
    };
    expect(reply.type).toBe('outcome');
    expect(reply.state).toBe('completed');
    expect(reply.data?.notebook_id).toBe('nb-t02-a');
    expect(reply.data?.echoed).toBe(true);
  });

  it('(b) frames a reply for a message that is not in any fixture', async () => {
    const unique = {
      action: 'run',
      notebook_id: 'nb-zxqv-not-in-fixtures-88421',
      notebook: '---\nname: UniqueProbe\nsteps:\n  - path: steps/zxqv-probe.js\n---\n',
      files: { 'steps/zxqv-probe.js': 'return 88421;' },
      tabId: 88421,
    };
    const res = await talk(encodeFrame(unique));
    expect(res.code).toBe(0);
    const reply = decodeFirst(res.stdout) as {
      type?: string;
      state?: string;
      data?: { notebook_id?: string };
    };
    expect(reply.type).toBe('outcome');
    expect(reply.state).toBe('completed');
    expect(reply.data?.notebook_id).toBe('nb-zxqv-not-in-fixtures-88421');
  });

  it('(c) frames a reply to a large message', async () => {
    const pad = 'x'.repeat(256 * 1024);
    const res = await talk(
      encodeFrame({
        action: 'run',
        notebook_id: 'nb-t02-large',
        files: { 'steps/pad.js': pad },
      }),
    );
    expect(res.code).toBe(0);
    const reply = decodeFirst(res.stdout) as {
      type?: string;
      data?: { notebook_id?: string };
    };
    expect(reply.type).toBe('outcome');
    expect(reply.data?.notebook_id).toBe('nb-t02-large');
  });

  it('(d) rejects a malformed frame with a visible error (INV-8)', async () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(100, 0);
    const res = await talk(Buffer.concat([header, Buffer.from('{"action":"run"}', 'utf8')]));
    expect(res.code).not.toBe(0);
    expect(res.stderr.length).toBeGreaterThan(0);
    expect(res.stderr).toMatch(/panjang tidak cocok/i);
    expect(res.stdout.length).toBe(0);
  });
});

import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  utf8ByteLength,
  splitJsonByUtf8Bytes,
  splitOutgoingMessage,
  sendOutgoingMessage,
  SPLIT_THRESHOLD,
  isChunkEnvelope,
  type ChunkEnvelope,
} from './frame-out';

describe('RQ-07 & INV-22: Outgoing frame splitting and byte-level threshold', () => {
  it('1. INV-22: byte count differs from string .length for multi-byte emojis (ratio 2)', () => {
    const singleEmoji = '😀';
    expect(singleEmoji.length).toBe(2); // UTF-16 surrogate pair
    expect(utf8ByteLength(singleEmoji)).toBe(4); // UTF-8 bytes

    // 440,000 emojis = 880,000 chars, but 1,760,000 UTF-8 bytes!
    const emojis = singleEmoji.repeat(440000);
    expect(emojis.length).toBe(880000);
    expect(utf8ByteLength(emojis)).toBe(1760000);

    // If naive .length was used, 880,030 chars would be < 900,000 and would FAIL to split!
    // But in UTF-8 bytes, it is 1,760,030 > 900,000 bytes.
    const payload = { type: 'progress', pad12: emojis };
    const json = JSON.stringify(payload);
    expect(json.length).toBe(880030);
    expect(utf8ByteLength(json)).toBe(1760030);

    // Byte to char ratio of the emoji portion is exactly 2:
    const emojiBytes = utf8ByteLength(emojis);
    const emojiChars = emojis.length;
    expect(emojiBytes / emojiChars).toBe(2);
  });

  it('2. Messages under SPLIT_THRESHOLD (900,000 bytes) are not split', () => {
    expect(SPLIT_THRESHOLD).toBe(900_000);
    const smallMessage = { type: 'status', state: 'idle', count: 42 };
    const frames = splitOutgoingMessage(smallMessage);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(smallMessage);
  });

  it('3. Slices codepoints cleanly without breaking surrogate pairs', () => {
    const emojis = '😀'.repeat(10);
    const pieces = splitJsonByUtf8Bytes(emojis, 12); // Each emoji is 4 bytes, so 3 emojis (12 bytes) per piece
    expect(pieces).toHaveLength(4);
    expect(pieces[0]).toBe('😀😀😀');
    expect(pieces[1]).toBe('😀😀😀');
    expect(pieces[2]).toBe('😀😀😀');
    expect(pieces[3]).toBe('😀');
    expect(pieces.join('')).toBe(emojis);
  });

  it('4. RQ-07 & D-23 T-05: splits 1,760,030 byte emoji payload into frames <= 1,000,000 bytes', () => {
    const emojis = '😀'.repeat(440000);
    const payload = { type: 'progress', pad12: emojis };
    const originalJson = JSON.stringify(payload);
    expect(originalJson.length).toBe(880030);
    expect(utf8ByteLength(originalJson)).toBe(1760030);

    const frames = splitOutgoingMessage(payload) as ChunkEnvelope[];
    expect(frames.length).toBeGreaterThanOrEqual(2);

    const chunkId = frames[0].chunkId;
    expect(typeof chunkId).toBe('string');
    expect(chunkId.length).toBeGreaterThan(0);

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      expect(isChunkEnvelope(f)).toBe(true);
      expect(f.chunkId).toBe(chunkId);
      expect(f.part).toBe(i + 1);
      expect(f.parts).toBe(frames.length);

      // Total envelope frame size is safely under 1,000,000 bytes (MAX_FRAME_BYTES)
      const envelopeBytes = utf8ByteLength(JSON.stringify(f));
      expect(envelopeBytes).toBeLessThanOrEqual(1000000);
    }

    // Reassembly matches byte-for-byte:
    const reassembledJson = frames.map((f) => f.data).join('');
    expect(reassembledJson).toBe(originalJson);

    const originalSha = crypto.createHash('sha256').update(originalJson, 'utf8').digest('hex');
    const reassembledSha = crypto.createHash('sha256').update(reassembledJson, 'utf8').digest('hex');
    expect(reassembledSha).toBe(originalSha);

    const decoded = JSON.parse(reassembledJson);
    expect(decoded).toEqual(payload);
  });

  it('5. Host process receives chunks, logs to received.jsonl, and reassembles identically', async () => {
    const emojis = '😀'.repeat(440000);
    const payload = { type: 'progress', pad12: emojis };
    const originalJson = JSON.stringify(payload);
    const originalSha = crypto.createHash('sha256').update(originalJson, 'utf8').digest('hex');

    const frames = splitOutgoingMessage(payload) as ChunkEnvelope[];
    const chunkId = frames[0].chunkId;

    // Encode all chunk frames
    const encodedBuffers = frames.map((f) => encodeFrame(f));
    const combinedInput = Buffer.concat(encodedBuffers);

    const res = await talk(combinedInput);
    expect(res.code).toBe(0);

    // Verify reassembled file written by mock-native-host
    const reassembledPath = path.resolve('.tmp-native', `reassembled-${chunkId}.json`);
    expect(fs.existsSync(reassembledPath)).toBe(true);

    const reassembledContent = fs.readFileSync(reassembledPath, 'utf8');
    const reassembledSha = crypto.createHash('sha256').update(reassembledContent, 'utf8').digest('hex');

    expect(reassembledSha).toBe(originalSha);
    expect(reassembledContent.length).toBe(originalJson.length);
    expect(Buffer.byteLength(reassembledContent, 'utf8')).toBe(1760030);

    // Verify received.jsonl contains all parts
    const receivedPath = path.resolve('.tmp-native', 'received.jsonl');
    expect(fs.existsSync(receivedPath)).toBe(true);
    const receivedLines = fs
      .readFileSync(receivedPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    const chunkRecords = receivedLines.filter((l) => l.chunkId === chunkId);
    expect(chunkRecords.length).toBe(frames.length);
    expect(chunkRecords[0].part).toBe(1);
    expect(chunkRecords[0].parts).toBe(frames.length);
    expect(chunkRecords[chunkRecords.length - 1].part).toBe(frames.length);
  });

  it('6. sendOutgoingMessage dispatches all split parts to port.postMessage', () => {
    const posted: unknown[] = [];
    const mockPort = {
      postMessage: (msg: unknown) => {
        posted.push(msg);
      },
    };
    const emojis = '😀'.repeat(440000);
    sendOutgoingMessage(mockPort, { type: 'progress', pad12: emojis });
    expect(posted.length).toBeGreaterThanOrEqual(2);
  });

  it('7. RQ-05: quote-dense payload splits into frames <= 1,000,000 bytes and reassembles identically', async () => {
    const payload = { type: 'step', evidence: { domSnippet: '"'.repeat(1_500_000) } };
    const originalJson = JSON.stringify(payload);
    const originalSha = crypto.createHash('sha256').update(originalJson, 'utf8').digest('hex');

    const frames = splitOutgoingMessage(payload) as ChunkEnvelope[];
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.length).toBeLessThanOrEqual(9);

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const envelopeBytes = utf8ByteLength(JSON.stringify(f));
      expect(envelopeBytes).toBeLessThanOrEqual(1000000);
    }

    const reassembledJson = frames.map((f) => f.data).join('');
    expect(reassembledJson).toBe(originalJson);
    const reassembledSha = crypto.createHash('sha256').update(reassembledJson, 'utf8').digest('hex');
    expect(reassembledSha).toBe(originalSha);

    // Host receives all frames, does not crash, and reassembles identically
    const encodedBuffers = frames.map((f) => encodeFrame(f));
    const res = await talk(Buffer.concat(encodedBuffers));
    expect(res.code).toBe(0);

    const reassembledPath = path.resolve('.tmp-native', `reassembled-${frames[0].chunkId}.json`);
    expect(fs.existsSync(reassembledPath)).toBe(true);
    const hostContent = fs.readFileSync(reassembledPath, 'utf8');
    const hostSha = crypto.createHash('sha256').update(hostContent, 'utf8').digest('hex');
    expect(hostSha).toBe(originalSha);
  });

  it('8. RQ-05: dense HTML payload splits into frames <= 1,000,000 bytes and reassembles identically', async () => {
    const payload = {
      type: 'step',
      evidence: { domSnippet: '<div class="row"><span class="name">Sari</span></div>'.repeat(25_000) },
    };
    const originalJson = JSON.stringify(payload);
    const originalSha = crypto.createHash('sha256').update(originalJson, 'utf8').digest('hex');

    const frames = splitOutgoingMessage(payload) as ChunkEnvelope[];
    expect(frames.length).toBeGreaterThan(1);

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const envelopeBytes = utf8ByteLength(JSON.stringify(f));
      expect(envelopeBytes).toBeLessThanOrEqual(1000000);
    }

    const reassembledJson = frames.map((f) => f.data).join('');
    expect(reassembledJson).toBe(originalJson);
    const reassembledSha = crypto.createHash('sha256').update(reassembledJson, 'utf8').digest('hex');
    expect(reassembledSha).toBe(originalSha);

    const encodedBuffers = frames.map((f) => encodeFrame(f));
    const res = await talk(Buffer.concat(encodedBuffers));
    expect(res.code).toBe(0);

    const reassembledPath = path.resolve('.tmp-native', `reassembled-${frames[0].chunkId}.json`);
    expect(fs.existsSync(reassembledPath)).toBe(true);
    const hostContent = fs.readFileSync(reassembledPath, 'utf8');
    const hostSha = crypto.createHash('sha256').update(hostContent, 'utf8').digest('hex');
    expect(hostSha).toBe(originalSha);
  });
});

