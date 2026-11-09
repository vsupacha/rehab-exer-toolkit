/** User-started local camera. Snapshot only; no upload or recording. */
export class LocalCamera {
  constructor(video, {mediaDevices = globalThis.navigator?.mediaDevices, canvasFactory = () => document.createElement('canvas')} = {}) {
    this.video = video; this.mediaDevices = mediaDevices; this.canvasFactory = canvasFactory;
    this.stream = null; this.opening = false; this.generation = 0;
  }
  async start() {
    if (this.stream || this.opening) return;
    if (!this.mediaDevices?.getUserMedia) throw new Error('กล้องต้องใช้ Chrome/Edge ผ่าน HTTPS หรือ localhost');
    const generation = ++this.generation; this.opening = true;
    try {
      const stream = await this.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:960},height:{ideal:540}}});
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream; this.video.srcObject = stream;
      try { await this.video.play(); } catch { /* Autoplay may require another user gesture. */ }
    } finally { if (generation === this.generation) this.opening = false; }
  }
  get ready() { return Boolean(this.stream?.getVideoTracks().some(t => t.readyState !== 'ended') && this.video.readyState >= 2 && this.video.videoWidth); }
  snapshot() {
    if (!this.ready) return null;
    const canvas = this.canvasFactory(), scale = Math.min(1,960 / this.video.videoWidth);
    canvas.width = Math.round(this.video.videoWidth * scale); canvas.height = Math.round(this.video.videoHeight * scale);
    canvas.getContext('2d').drawImage(this.video,0,0,canvas.width,canvas.height);
    return {url:canvas.toDataURL('image/jpeg',.85),at:Date.now(),width:canvas.width,height:canvas.height};
  }
  stop() {
    this.generation++; this.opening = false;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; this.video.srcObject = null;
  }
}
