// Empreinte de la voix d'un extrait (512 valeurs), calculée sur l'ordinateur : modèle CAM++
// de 3D-Speaker (licence Apache-2.0), entraîné sur VoxCeleb (des milliers de voix, toutes langues).
import type * as Ort from 'onnxruntime-web/wasm';
import { cosine, fbank, MEL_BINS } from '../../shared/fbank';

const SR = 16000;
/** fenêtre comparée de part et d'autre d'une coupe possible (aussi la durée minimale d'un morceau) */
const WIN = 1.5 * SR;
/** pas entre deux coupes possibles */
const HOP = 0.75 * SR;
/** sous cette similarité, les deux fenêtres voisines sont deux voix différentes (calibré sur AMI) */
export const CHANGE = 0.2;
/** la coupe glisse vers le passage le plus silencieux à ± cette distance (on ne coupe pas un mot) */
const SNAP = 0.375 * SR;
const SNAP_FRAME = 512;
/** en dessous d'une seconde, l'empreinte n'est pas fiable */
const MIN = SR;
/** au-delà de 12 s, le milieu de l'extrait suffit (et le calcul reste rapide) */
const MAX = 12 * SR;

export class VoicePrint {
  private constructor(
    private readonly ort: typeof Ort,
    private readonly session: Ort.InferenceSession,
  ) {}

  static async create(ort: typeof Ort, model: ArrayBuffer): Promise<VoicePrint> {
    const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
    return new VoicePrint(ort, session);
  }

  async embed(pcm: Float32Array): Promise<number[] | undefined> {
    if (pcm.length < MIN) return undefined;
    const from = pcm.length > MAX ? (pcm.length - MAX) >> 1 : 0;
    const { data, frames } = fbank(pcm.subarray(from, from + MAX));
    const out = await this.session.run({ x: new this.ort.Tensor('float32', data, [1, frames, MEL_BINS]) });
    const e = out[this.session.outputNames[0]].data as Float32Array;
    let n = 0;
    for (const v of e) n += v * v;
    n = Math.sqrt(n) || 1;
    return Array.from(e, (v) => v / n);
  }
}

/**
 * Où la voix change dans un extrait (positions en échantillons, croissantes) : quand deux personnes
 * se répondent sans pause, le segmenteur n'a rien pour couper. On compare les empreintes de deux
 * fenêtres de 1,5 s collées l'une à l'autre, tous les 0,75 s ; on coupe aux creux de ressemblance
 * les plus nets, avec au moins 1,5 s de chaque côté. Extrait de moins de 3 s : jamais coupé.
 */
export async function voiceCuts(
  pcm: Float32Array,
  embed: (pcm: Float32Array) => Promise<ArrayLike<number> | undefined>,
  threshold = CHANGE,
): Promise<number[]> {
  if (pcm.length < 2 * WIN) return [];
  const prints: (ArrayLike<number> | undefined)[] = [];
  for (let at = 0; at + WIN <= pcm.length; at += HOP) prints.push(await embed(pcm.subarray(at, at + WIN)));
  const step = WIN / HOP;
  const candidates: { at: number; sim: number }[] = [];
  for (let i = 0; i + step < prints.length; i++) {
    const a = prints[i];
    const b = prints[i + step];
    if (!a || !b) continue;
    const sim = cosine(a, b);
    if (sim < threshold) candidates.push({ at: i * HOP + WIN, sim });
  }
  const cuts: number[] = [];
  for (const c of candidates.sort((x, y) => x.sim - y.sim)) {
    if (cuts.every((k) => Math.abs(k - c.at) >= WIN)) cuts.push(c.at);
  }
  return cuts.sort((x, y) => x - y).map((at) => quietest(pcm, at));
}

/** Début de la trame la plus silencieuse autour de `at`. */
function quietest(pcm: Float32Array, at: number): number {
  let best = at;
  let low = Infinity;
  for (let from = Math.max(0, at - SNAP); from + SNAP_FRAME <= Math.min(pcm.length, at + SNAP); from += SNAP_FRAME / 2) {
    let e = 0;
    for (let i = from; i < from + SNAP_FRAME; i++) e += pcm[i] * pcm[i];
    if (e < low) {
      low = e;
      best = from + SNAP_FRAME / 2;
    }
  }
  return best;
}
