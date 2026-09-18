/**
 * Task 069 (V-002) — the microphone's audio worklet.
 *
 * The transcription socket takes signed 16-bit PCM; the browser hands the
 * worklet 32-bit floats in blocks of 128 frames. This converts and buffers
 * them, posting roughly 100 ms at a time so the page wakes about ten times
 * a second rather than a hundred and twenty.
 *
 * Served as a static file from the app's own origin: an audio worklet is
 * fetched as a script, and `script-src 'self'` covers a same-origin path
 * without the blob: source that a bundled worklet would need.
 *
 * Kept as plain JavaScript because it runs in the audio rendering realm,
 * which the app bundle never enters.
 */

/** 16 kHz × 100 ms. The page's own sample rate is fixed by the AudioContext. */
const CHUNK_SAMPLES = 1600;

class MantuaPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
  }

  /**
   * @param {Float32Array[][]} inputs
   * @returns {boolean} true to stay alive until the node is disconnected
   */
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      // Clamp before scaling: a sample outside [-1, 1] would wrap.
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.filled] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.filled += 1;

      if (this.filled === CHUNK_SAMPLES) {
        const chunk = this.buffer.slice(0, CHUNK_SAMPLES);
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("mantua-pcm", MantuaPcmProcessor);
