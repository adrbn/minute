// Récupère l'audio (déjà rééchantillonné à 16 kHz par l'AudioContext),
// le mixe en mono et l'envoie par trames de 512 échantillons (32 ms).
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(512);
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const chs = input.length;
      const len = input[0].length;
      for (let i = 0; i < len; i++) {
        let v = 0;
        for (let c = 0; c < chs; c++) v += input[c][i];
        this.buf[this.n++] = v / chs;
        if (this.n === 512) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(512);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-tap', PcmTap);
