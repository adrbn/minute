// Empreinte de la voix d'un extrait (512 valeurs), calculée sur l'ordinateur : modèle CAM++
// de 3D-Speaker (licence Apache-2.0), entraîné sur VoxCeleb (des milliers de voix, toutes langues).
import type * as Ort from 'onnxruntime-web/wasm';
import { fbank, MEL_BINS } from '../../shared/fbank';

const SR = 16000;
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
