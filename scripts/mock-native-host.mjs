import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-native');

function fail(message) {
  fs.writeSync(2, `${message}\n`);
  process.exit(1);
}

function resolveTmpPath(name) {
  const resolved = path.resolve(HOST_DIR, name);
  const root = HOST_DIR.endsWith(path.sep) ? HOST_DIR : HOST_DIR + path.sep;
  if (resolved !== HOST_DIR && !resolved.startsWith(root)) {
    fail(`INV-18: path di luar .tmp-native/: ${name}`);
  }
  return resolved;
}

function readCommand() {
  if (process.env.MOCK_NATIVE_FROM_CHROME !== '1') return null;
  const commandPath = resolveTmpPath('command.json');
  if (!fs.existsSync(commandPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(commandPath, 'utf8'));
  } catch (err) {
    fail(`Gagal membaca command.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function writeFrame(payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  fs.writeSync(1, header);
  fs.writeSync(1, json);
}

function makeStdinReader() {
  let buf = Buffer.alloc(0);
  let ended = false;
  const waiters = [];
  const wake = () => {
    while (waiters.length) waiters.shift()();
  };
  process.stdin.on('data', (chunk) => {
    buf = Buffer.concat([buf, Buffer.from(chunk)]);
    wake();
  });
  process.stdin.on('end', () => {
    ended = true;
    wake();
  });
  process.stdin.resume();

  async function readExact(needed) {
    while (buf.length < needed && !ended) {
      await new Promise((r) => waiters.push(r));
    }
    if (buf.length < needed) {
      const got = buf;
      buf = Buffer.alloc(0);
      return { bytes: got, eof: true };
    }
    const bytes = buf.subarray(0, needed);
    buf = buf.subarray(needed);
    return { bytes, eof: false };
  }

  return { readExact, isEnded: () => ended && buf.length === 0 };
}

const stdinReader = makeStdinReader();

async function readFrame() {
  const header = await stdinReader.readExact(4);
  if (header.eof && header.bytes.length === 0) return null;
  if (header.eof || header.bytes.length !== 4) {
    fail(
      `Bingkai cacat: header panjang tidak lengkap (diharapkan 4 byte, diterima ${header.bytes.length})`,
    );
  }
  const expected = header.bytes.readUInt32LE(0);
  if (expected > 1048576) {
    fail(`Bingkai melebihi batas native 1.048.576 byte: diterima ${expected} byte`);
  }
  const body = await stdinReader.readExact(expected);
  if (body.eof || body.bytes.length !== expected) {
    fail(
      `Bingkai cacat: panjang tidak cocok isi (diharapkan ${expected} byte, diterima ${body.bytes.length})`,
    );
  }
  try {
    return {
      bytes: expected,
      payload: JSON.parse(body.bytes.toString('utf8')),
    };
  } catch (err) {
    fail(`Bingkai cacat: JSON tidak sah (${err instanceof Error ? err.message : String(err)})`);
  }
}

function emitPushFile() {
  const pushPath = resolveTmpPath('push.json');
  if (!fs.existsSync(pushPath)) return;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(pushPath, 'utf8'));
  } catch {
    return;
  }
  try {
    fs.unlinkSync(pushPath);
  } catch {}
  writeFrame(payload);
}

function replyFor(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return {
      type: 'outcome',
      state: 'needs_review',
      reason: 'Pesan host tidak valid (bukan objek)',
    };
  }
  const action = message.action;
  if (action === 'run') {
    return {
      type: 'outcome',
      state: 'completed',
      reason: 'Host tiruan membalas run',
      data: {
        notebook_id: message.notebook_id ?? null,
        echoed: true,
      },
      lastSuccessCellId: null,
      executedCellIds: [],
    };
  }
  if (action === 'cancel') {
    return {
      type: 'outcome',
      state: 'needs_review',
      reason: 'Eksekusi dibatalkan atas permintaan host',
    };
  }
  if (action === 'status') {
    return {
      type: 'status',
      state: 'idle',
      activeNotebook: message.notebook_id,
    };
  }
  return {
    type: 'outcome',
    state: 'needs_review',
    reason: `Action tidak dikenal: '${action}'`,
  };
}

function emitSized(byteCount) {
  const n = Number(byteCount);
  if (!Number.isFinite(n) || n < 0) {
    fail(`emit-size tidak sah: ${byteCount}`);
  }
  const overhead = Buffer.byteLength('{"type":"status","state":"idle","pad":""}', 'utf8');
  const pad = Math.max(0, n - overhead);
  writeFrame({ type: 'status', state: 'idle', pad: 'x'.repeat(pad) });
}

function runCommand(command) {
  if (!command || typeof command !== 'object') return;
  if (command.mode === 'emit' && command.message) {
    writeFrame(command.message);
    return;
  }
  if (command.mode === 'emit-size') {
    emitSized(command.bytes);
    return;
  }
  if (command.mode === 'emit-sizes' && Array.isArray(command.sizes)) {
    for (const size of command.sizes) emitSized(size);
  }
  if (command.mode === 'emit-after-ms' && command.message) {
    const ms = Number(command.ms);
    const traceName = typeof command.trace === 'string' ? command.trace : 'trace.json';
    if (!Number.isFinite(ms) || ms < 0) {
      fail(`emit-after-ms tidak sah: ${command.ms}`);
    }
    pendingEmit = { ms, message: command.message, traceName, startedAt: Date.now() };
  }
}

try {
  fs.mkdirSync(HOST_DIR, { recursive: true });
} catch (err) {
  fail(`Gagal membuat .tmp-native/: ${err instanceof Error ? err.message : String(err)}`);
}

const alivePath = resolveTmpPath('alive.json');
try {
  fs.writeFileSync(alivePath, `${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`);
} catch (err) {
  fail(`Gagal menulis alive.json: ${err instanceof Error ? err.message : String(err)}`);
}
const clearAlive = () => {
  try {
    fs.unlinkSync(alivePath);
  } catch {}
};
process.on('exit', clearAlive);
process.on('SIGINT', () => {
  clearAlive();
  process.exit(0);
});

let pendingEmit = null;
let traceWritten = false;

function writeTrace(payload) {
  if (!pendingEmit || traceWritten) return;
  traceWritten = true;
  const tracePath = resolveTmpPath(pendingEmit.traceName);
  fs.writeFileSync(tracePath, `${JSON.stringify(payload)}\n`);
}

runCommand(readCommand());

if (pendingEmit) {
  const emitTimer = setTimeout(() => {
    writeFrame(pendingEmit.message);
    const replyTimer = setTimeout(() => {
      writeTrace({
        emittedAt: Date.now(),
        gotReply: false,
        reason: 'no-reply-timeout',
      });
    }, 15000);
    replyTimer.unref();
  }, pendingEmit.ms);
  emitTimer.unref();
}

const pushTimer = setInterval(emitPushFile, 200);
pushTimer.unref();
emitPushFile();

function isChunkEnvelope(value) {
  if (value === null || typeof value !== 'object') return false;
  return (
    typeof value.chunkId === 'string' &&
    typeof value.part === 'number' &&
    typeof value.parts === 'number' &&
    typeof value.data === 'string'
  );
}

class ChunkAssembler {
  constructor() {
    this.pending = new Map();
  }

  push(message) {
    if (!isChunkEnvelope(message)) {
      return { complete: true, payload: message };
    }
    if (message.part < 1 || message.part > message.parts || message.parts < 1) {
      fail(`Bingkai pecahan tidak berurutan: part=${message.part} parts=${message.parts}`);
    }

    let rec = this.pending.get(message.chunkId);
    if (!rec) {
      if (message.part !== 1) {
        fail(`Bingkai pecahan tidak berurutan: part ${message.part} tiba sebelum part 1`);
      }
      rec = { parts: message.parts, lastPart: 0, got: new Map() };
      this.pending.set(message.chunkId, rec);
    }

    if (message.parts !== rec.parts) {
      fail(`Bingkai pecahan tidak berurutan: parts berubah dari ${rec.parts} ke ${message.parts}`);
    }
    if (message.part !== rec.lastPart + 1) {
      fail(`Bingkai pecahan tidak berurutan: diharapkan part ${rec.lastPart + 1}, diterima ${message.part}`);
    }

    rec.got.set(message.part, message.data);
    rec.lastPart = message.part;

    if (message.part !== message.parts) {
      return { complete: false };
    }

    this.pending.delete(message.chunkId);
    const json = Array.from({ length: rec.parts }, (_, idx) => rec.got.get(idx + 1) ?? '').join('');
    try {
      return { complete: true, payload: JSON.parse(json), rawJson: json };
    } catch (err) {
      fail(`Penyusunan ulang pecahan menghasilkan JSON tidak sah: ${err.message}`);
    }
  }
}

const assembler = new ChunkAssembler();

async function loop() {
  for (;;) {
    const frame = await readFrame();
    if (frame === null) break;
    const { bytes, payload: message } = frame;

    const isChunk = isChunkEnvelope(message);
    const logItem = {
      ts: Date.now(),
      bytes,
      type: message.type || (isChunk ? 'chunk' : undefined),
    };
    if (message.runId !== undefined) logItem.runId = message.runId;
    if (message.cellId !== undefined) logItem.cellId = message.cellId;
    if (message.part !== undefined) logItem.part = message.part;
    if (message.parts !== undefined) logItem.parts = message.parts;
    if (message.chunkId !== undefined) logItem.chunkId = message.chunkId;
    if (message.frameId !== undefined) logItem.frameId = message.frameId;
    if (message.build !== undefined) logItem.build = message.build;
    if (message.extVersion !== undefined) logItem.extVersion = message.extVersion;
    if (message.profileHint !== undefined) logItem.profileHint = message.profileHint;
    if (message.state !== undefined) logItem.state = message.state;
    if (message.reason !== undefined) logItem.reason = message.reason;
    if (message.cause !== undefined) logItem.cause = message.cause;
    if (message.action !== undefined) logItem.action = message.action;
    if (message.executedCellIds !== undefined) logItem.executedCellIds = message.executedCellIds;
    if (message.lastSuccessCellId !== undefined) logItem.lastSuccessCellId = message.lastSuccessCellId;
    if (message.data !== undefined) logItem.data = message.data;
    if (message.durationMs !== undefined) logItem.durationMs = message.durationMs;
    if (message.candidateHit !== undefined) logItem.candidateHit = message.candidateHit;
    if (message.candidatesTried !== undefined) logItem.candidatesTried = message.candidatesTried;
    if (message.dataDiff !== undefined) logItem.dataDiff = message.dataDiff;
    if (message.evidence !== undefined) logItem.evidence = message.evidence;
    if (message.error !== undefined) logItem.error = message.error;

    try {
      fs.appendFileSync(resolveTmpPath('received.jsonl'), `${JSON.stringify(logItem)}\n`);
    } catch (err) {
      fail(`Gagal mencatat received.jsonl: ${err.message}`);
    }

    if (isChunk) {
      const res = assembler.push(message);
      if (res.complete && res.rawJson) {
        fs.writeFileSync(resolveTmpPath(`reassembled-${message.chunkId}.json`), res.rawJson, 'utf8');
        if (message.frameId) {
          fs.writeFileSync(resolveTmpPath(`reassembled-${message.frameId}.json`), res.rawJson, 'utf8');
        }
      }
    }

    if (message.type === 'hello') {
      const command = readCommand();
      if (command && (command.mode === 'disconnect-on-hello' || command.disconnectOnHello)) {
        setTimeout(() => {
          process.exit(0);
        }, 50);
      }
    }

    if (pendingEmit && message && (message.type === 'outcome' || message.type === 'status')) {
      writeTrace({
        emittedAt: Date.now(),
        gotReply: true,
        reply: message,
      });
      continue;
    }

    if (message && message.action) {
      writeFrame(replyFor(message));
    }
  }
}

loop()
  .catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  })
  .finally(() => {
    clearInterval(pushTimer);
  });
