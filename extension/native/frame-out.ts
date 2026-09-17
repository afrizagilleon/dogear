/**
 * extension/native/frame-out.ts
 * Outgoing frame splitting for large payloads (D-22 T-02, D-23 T-05, RQ-05, K-5, INV-22).
 * Envelope format shared with the companion desktop host.
 */

export const SPLIT_THRESHOLD = 900_000;
export const MAX_FRAME_BYTES = 1_000_000;
export const HEADER_SIZE = 4;
export const CHUNK_DATA_BYTES = 700_000;
const ENVELOPE_PARTS_GUESS = 9999;

export type ChunkEnvelope = {
  chunkId: string;
  part: number;
  parts: number;
  data: string;
};

let chunkSeq = 0;

export function makeChunkId(): string {
  chunkSeq += 1;
  return `${Date.now().toString(16)}-${chunkSeq.toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function isChunkEnvelope(value: unknown): value is ChunkEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.chunkId === 'string' &&
    typeof rec.part === 'number' &&
    typeof rec.parts === 'number' &&
    typeof rec.data === 'string'
  );
}

function utf8LenCp(cp: number): number {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

export function utf8ByteLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    if (cp === undefined) break;
    n += utf8LenCp(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return n;
}

export function envelopeFrameBytes(chunkId: string, part: number, parts: number, data: string): number {
  const json = JSON.stringify({ chunkId, part, parts, data });
  return HEADER_SIZE + utf8ByteLength(json);
}

function snapUtf16End(json: string, start: number, end: number): number {
  if (end <= start) return start;
  if (end > json.length) return json.length;
  const prev = json.charCodeAt(end - 1);
  if (prev >= 0xd800 && prev <= 0xdbff && end < json.length) return end - 1;
  return end;
}

function maxEnvelopeEnd(
  json: string,
  start: number,
  chunkId: string,
  part: number,
  parts: number,
  maxBytes: number = MAX_FRAME_BYTES,
): number {
  if (start >= json.length) return start;
  if (envelopeFrameBytes(chunkId, part, parts, json.slice(start)) <= maxBytes) {
    return json.length;
  }
  let lo = 1;
  let hi = json.length - start;
  let best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const end = snapUtf16End(json, start, start + mid);
    const take = end - start;
    if (take <= 0) {
      lo = mid + 1;
      continue;
    }
    const n = envelopeFrameBytes(chunkId, part, parts, json.slice(start, end));
    if (n <= maxBytes) {
      best = take;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best <= 0) {
    throw new Error(`Satu pecahan tidak muat di bingkai ${maxBytes} byte`);
  }
  return start + best;
}

export function splitJsonByUtf8Bytes(json: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let i = 0;
  while (i < json.length) {
    let end = i;
    let bytes = 0;
    while (end < json.length) {
      const cp = json.codePointAt(end);
      if (cp === undefined) break;
      const n = utf8LenCp(cp);
      const adv = cp > 0xffff ? 2 : 1;
      if (bytes + n > maxBytes && bytes > 0) break;
      if (n > maxBytes) {
        throw new Error(`Satu titik kode ${n} byte tidak muat di pecahan ${maxBytes}`);
      }
      bytes += n;
      end += adv;
    }
    pieces.push(json.slice(i, end));
    i = end;
  }
  return pieces;
}

export function splitJsonByEnvelope(json: string, chunkId: string, maxBytes: number = MAX_FRAME_BYTES): string[] {
  const pieces: string[] = [];
  let i = 0;
  while (i < json.length) {
    const end = maxEnvelopeEnd(json, i, chunkId, ENVELOPE_PARTS_GUESS, ENVELOPE_PARTS_GUESS, maxBytes);
    pieces.push(json.slice(i, end));
    i = end;
  }
  return pieces;
}

export function splitOutgoingMessage(message: unknown): unknown[] {
  const json = JSON.stringify(message);
  const bytes = utf8ByteLength(json);
  if (bytes <= SPLIT_THRESHOLD) {
    return [message];
  }

  const chunkId = makeChunkId();
  let maxFrameBudget = MAX_FRAME_BYTES;
  let pieces = splitJsonByEnvelope(json, chunkId, maxFrameBudget);

  // Penjaga per-bingkai dan mundur-setengah (K-5, RQ-05)
  let frames: ChunkEnvelope[] = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const parts = pieces.length;
    frames = pieces.map((piece, idx) => ({
      chunkId,
      part: idx + 1,
      parts,
      data: piece,
    } satisfies ChunkEnvelope));

    let exceeded = false;
    for (const frame of frames) {
      const frameBytes = envelopeFrameBytes(frame.chunkId, frame.part, frame.parts, frame.data);
      if (frameBytes > MAX_FRAME_BYTES) {
        exceeded = true;
        break;
      }
    }

    if (!exceeded) {
      break;
    }

    // Mundur-setengah: belah dua sisa anggaran / kurangi budget dan hitung ulang
    maxFrameBudget = Math.floor(maxFrameBudget * 0.9);
    if (maxFrameBudget < 100_000) {
      throw new Error(`Bingkai tidak muat di ${MAX_FRAME_BYTES} byte sesudah mundur-setengah`);
    }
    pieces = splitJsonByEnvelope(json, chunkId, maxFrameBudget);
  }

  // Penjaga akhir: pastikan semua bingkai <= MAX_FRAME_BYTES
  for (const frame of frames) {
    const frameBytes = envelopeFrameBytes(frame.chunkId, frame.part, frame.parts, frame.data);
    if (frameBytes > MAX_FRAME_BYTES) {
      throw new Error(`Bingkai pecahan ${frameBytes} byte melebihi ${MAX_FRAME_BYTES}`);
    }
  }

  return frames;
}

export interface MinimalPort {
  postMessage: (msg: unknown) => void;
}

export function sendOutgoingMessage(port: MinimalPort, message: unknown): void {
  const frames = splitOutgoingMessage(message);
  for (const frame of frames) {
    if (isChunkEnvelope(frame)) {
      const frameBytes = envelopeFrameBytes(frame.chunkId, frame.part, frame.parts, frame.data);
      if (frameBytes > MAX_FRAME_BYTES) {
        throw new Error(`Penjaga per-bingkai: bingkai keluar ${frameBytes} byte melebihi ${MAX_FRAME_BYTES}`);
      }
    } else {
      const frameBytes = HEADER_SIZE + utf8ByteLength(JSON.stringify(frame));
      if (frameBytes > MAX_FRAME_BYTES) {
        throw new Error(`Penjaga per-bingkai: bingkai keluar ${frameBytes} byte melebihi ${MAX_FRAME_BYTES}`);
      }
    }
    port.postMessage(frame);
  }
}

