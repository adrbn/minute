// macOS : le son de l'ordinateur est capté par AudioTee (Core Audio Taps,
// macOS 14.2+, licence MIT) — un petit binaire qui écrit du PCM sur stdout
// et annonce le format réel sur stderr (JSON « metadata »).
import { app, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function audioteePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', 'audiotee')
    : join(app.getAppPath(), 'resources', 'mac', 'audiotee');
}

interface Format {
  rate: number;
  channels: number;
  bits: number;
  float: boolean;
}

const TARGET: Format = { rate: 16000, channels: 1, bits: 16, float: false };

/** Convertit n'importe quel PCM entrelacé en Int16 mono 16 kHz. */
function toTarget(buf: Buffer, f: Format): Buffer {
  const bytes = f.bits / 8;
  const frames = Math.floor(buf.length / (bytes * f.channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let v = 0;
    for (let c = 0; c < f.channels; c++) {
      const o = (i * f.channels + c) * bytes;
      v += f.float ? buf.readFloatLE(o) : f.bits === 16 ? buf.readInt16LE(o) / 0x8000 : buf.readInt32LE(o) / 0x80000000;
    }
    mono[i] = v / f.channels;
  }
  const ratio = f.rate / TARGET.rate;
  const outLen = Math.floor(frames / ratio);
  const out = Buffer.alloc(outLen * 2);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const t = x - j;
    const v = (mono[j] ?? 0) * (1 - t) + (mono[j + 1] ?? mono[j] ?? 0) * t;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  return out;
}

const same = (a: Format, b: Format) => a.rate === b.rate && a.channels === b.channels && a.bits === b.bits && a.float === b.float;

export function createMacSystemAudio() {
  let proc: ChildProcessWithoutNullStreams | null = null;
  let stopping = false;

  return {
    async start(onPcm: (pcm: Buffer) => void, onError: (msg: string) => void) {
      const bin = audioteePath();
      if (!existsSync(bin)) {
        onError('Composant audio système absent de cette version (audiotee).');
        return;
      }
      stopping = false;
      let gotAudio = false;
      let fmt: Format = { ...TARGET };
      let carry = Buffer.alloc(0);
      proc = spawn(bin, ['--sample-rate', '16000', '--chunk-duration', '0.1'], { stdio: 'pipe' });

      proc.stdout.on('data', (chunk: Buffer) => {
        gotAudio = true;
        const frameBytes = (fmt.bits / 8) * fmt.channels;
        let buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        const usable = buf.length - (buf.length % frameBytes);
        carry = Buffer.from(buf.subarray(usable));
        buf = buf.subarray(0, usable);
        if (!buf.length) return;
        onPcm(same(fmt, TARGET) ? Buffer.from(buf) : toTarget(buf, fmt));
      });

      let stderr = '';
      let lineBuf = '';
      proc.stderr.on('data', (d: Buffer) => {
        const text = d.toString();
        stderr = (stderr + text).slice(-2000);
        lineBuf += text;
        let nl: number;
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (!line.startsWith('{')) continue;
          try {
            const msg = JSON.parse(line) as Record<string, unknown>;
            const data = (msg.data ?? msg) as Record<string, unknown>;
            if (typeof data.sample_rate === 'number') {
              fmt = {
                rate: data.sample_rate,
                channels: Number(data.channels_per_frame) || 1,
                bits: Number(data.bits_per_channel) || 16,
                float: !!data.is_float,
              };
            }
          } catch {
            /* ligne de journal non JSON */
          }
        }
      });

      proc.on('exit', (code) => {
        proc = null;
        if (stopping) return;
        const denied = /permission|denied|not authorized|tcc/i.test(stderr);
        onError(
          denied || !gotAudio
            ? 'Autorisez « Enregistrement audio du système » pour Minute (Réglages Système › Confidentialité et sécurité).'
            : `Capture du son système interrompue (code ${code}).`,
        );
      });
    },
    stop() {
      stopping = true;
      proc?.kill('SIGTERM');
      proc = null;
    },
  };
}

export function openMacPrivacy(kind: 'microphone' | 'audio') {
  const anchor = kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_AudioCapture';
  void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`);
}
