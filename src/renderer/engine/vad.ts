// Détection de parole Silero VAD v5 (licence MIT) via onnxruntime-web.
// Interface du modèle : input [1, 64+512] (64 échantillons de contexte), state [2,1,128], sr.
import type * as Ort from 'onnxruntime-web/wasm';

const CONTEXT = 64;

export class SileroVad {
  private state: Ort.Tensor;
  private context = new Float32Array(CONTEXT);
  private readonly sr: Ort.Tensor;

  private constructor(
    private readonly ort: typeof Ort,
    private readonly session: Ort.InferenceSession,
  ) {
    this.state = this.zeroState();
    this.sr = new ort.Tensor('int64', BigInt64Array.from([16000n]));
  }

  static async create(ort: typeof Ort, model: ArrayBuffer): Promise<SileroVad> {
    const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
    return new SileroVad(ort, session);
  }

  private zeroState() {
    return new this.ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  }

  reset() {
    this.state = this.zeroState();
    this.context = new Float32Array(CONTEXT);
  }

  /** Probabilité de parole (0..1) pour une trame de 512 échantillons à 16 kHz. */
  async prob(frame: Float32Array): Promise<number> {
    const input = new Float32Array(CONTEXT + frame.length);
    input.set(this.context, 0);
    input.set(frame, CONTEXT);
    this.context = frame.slice(-CONTEXT);
    const out = await this.session.run({
      input: new this.ort.Tensor('float32', input, [1, input.length]),
      state: this.state,
      sr: this.sr,
    });
    this.state = out.stateN as Ort.Tensor;
    return (out.output as Ort.Tensor).data[0] as number;
  }
}
