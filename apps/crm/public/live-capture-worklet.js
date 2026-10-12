/**
 * Microphone tap for the live conversation. Runs on the audio thread and only forwards raw samples (about every
 * 40 ms) to the page, which resamples and sends them. Nothing is recorded or stored.
 */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.length++] = channel[i];
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.length = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("home88-pcm-capture", PcmCapture);
