/** WIT BLE 5.0 reader. Protocol references are in the repository README.md. */
export const UUID = Object.freeze({
  service: '0000ffe5-0000-1000-8000-00805f9a34fb',
  notify: '0000ffe4-0000-1000-8000-00805f9a34fb',
  write: '0000ffe9-0000-1000-8000-00805f9a34fb',
});

/** Stateful framing: notifications may contain partial or multiple 20-byte frames. */
export class WitMotionDecoder {
  constructor() { this.reset(); }
  reset() { this.buffer = []; this.discardedBytes = 0; }
  push(input) {
    const bytes = input instanceof DataView
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    const frames = [];
    for (const byte of bytes) {
      this.buffer.push(byte);
      while (this.buffer.length && this.buffer[0] !== 0x55) {
        this.buffer.shift(); this.discardedBytes++;
      }
      if (this.buffer.length >= 2 && ![0x61, 0x71].includes(this.buffer[1])) {
        this.buffer.shift(); this.discardedBytes++; continue;
      }
      if (this.buffer.length < 20) continue;
      const raw = Uint8Array.from(this.buffer.splice(0, 20));
      const view = new DataView(raw.buffer);
      const values = (offset, count, scale) => Array.from({length: count}, (_, i) => view.getInt16(offset + 2 * i, true) * scale);
      let frame = {type: 'unknown', raw};
      if (raw[1] === 0x61) {
        frame = {...frame, type: 'motion', acceleration: values(2, 3, 16 / 32768),
          angularVelocity: values(8, 3, 2000 / 32768), angles: values(14, 3, 180 / 32768)};
      } else {
        frame.register = view.getUint16(2, true);
        if (frame.register === 0x51) frame = {...frame, type: 'quaternion', quaternion: values(4, 4, 1 / 32768)};
        // Magnetic register scale differs by sensor; preserve raw counts only.
        if (frame.register === 0x3a) frame = {...frame, type: 'magnetic', magneticRaw: values(4, 3, 1)};
      }
      frames.push(frame);
    }
    return frames;
  }
}

export class WitMotion extends EventTarget {
  constructor({bluetooth = globalThis.navigator?.bluetooth, timeoutMs = 15000} = {}) {
    super();
    this.bluetooth = bluetooth;
    this.timeoutMs = timeoutMs;
    this.decoder = new WitMotionDecoder();
    this.status = 'disconnected';
    this._generation = 0;
    this._notify = event => this._receive(event.target.value);
    this._disconnected = () => { this._cleanup(); this.device = null; this._status('disconnected', 'Sensor connection closed'); };
  }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  _status(state, message = '') { this.status = state; this._emit('status', {state, message, deviceName: this.device?.name ?? ''}); }
  async _step(label, action, signal) {
    if (signal.aborted) throw new DOMException('Connection cancelled', 'AbortError');
    this._emit('progress', {message: label, deviceName: this.device?.name ?? ''});
    let timer, onAbort;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (signal.aborted) throw new DOMException('Connection cancelled', 'AbortError');
          return action();
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new DOMException(`${label}: timed out after ${this.timeoutMs / 1000} seconds`, 'TimeoutError')), this.timeoutMs);
          onAbort = () => reject(new DOMException('Connection cancelled', 'AbortError'));
          signal.addEventListener('abort', onAbort, {once: true});
        }),
      ]);
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
      throw new DOMException(`${label}: ${error.message}`, error.name || 'Error');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
  /** Call directly from a click. Opens the browser's device scan/permission chooser. */
  async connect({allDevices = false, excludedDeviceIds = []} = {}) {
    if (this.status !== 'disconnected') throw new Error('Disconnect the current session first.');
    if (!globalThis.isSecureContext) throw new Error('Use HTTPS or http://localhost for Bluetooth.');
    if (!this.bluetooth) throw new Error('Web Bluetooth is unavailable. Open this page in desktop Chrome or Edge.');
    const generation = ++this._generation;
    this._attempt = new AbortController();
    const signal = this._attempt.signal;
    this._status('selecting');
    try {
      const device = await this.bluetooth.requestDevice({
        ...(allDevices ? {acceptAllDevices: true} : {filters: [{services: [UUID.service]}, {namePrefix: 'WT'}, {namePrefix: 'Wit'}, {namePrefix: 'BWT'}]}),
        optionalServices: [UUID.service],
      });
      if (generation !== this._generation) return;
      if (excludedDeviceIds.includes(device.id)) throw new DOMException('This sensor is already assigned to the other arm. Choose another device.', 'InvalidStateError');
      this.device = device;
      device.addEventListener('gattserverdisconnected', this._disconnected);
      this._status('connecting');
      const server = await this._step('Connecting to sensor GATT', () => {
        const pending = device.gatt.connect();
        pending.then(() => {
          if (signal.aborted && this.device !== device) {
            try { device.gatt.disconnect(); } catch { /* Already closed. */ }
          }
        }, () => {});
        return pending;
      }, signal);
      if (generation !== this._generation) return;
      const service = await this._step('Discovering WIT service FFE5', () => server.getPrimaryService(UUID.service), signal);
      const notify = await this._step('Finding data characteristic FFE4', () => service.getCharacteristic(UUID.notify), signal);
      if (generation !== this._generation) return;
      this.characteristic = notify;
      notify.addEventListener('characteristicvaluechanged', this._notify);
      await this._step('Enabling motion notifications', () => notify.startNotifications(), signal);
      if (generation !== this._generation) return;
      this._status('connected', 'Waiting for motion data');
      try {
        const writer = await this._step('Finding optional register characteristic FFE9', () => service.getCharacteristic(UUID.write), signal);
        if (generation === this._generation) this.writer = writer;
      }
      catch {
        if (generation === this._generation) this._emit('warning', 'Additional register reads are unavailable; motion notifications remain enabled.');
      }
    } catch (error) {
      if (generation !== this._generation) return;
      const selecting = this.status === 'selecting';
      this.disconnect();
      if (error.name === 'NotFoundError' && selecting) this._emit('warning', 'Device selection cancelled.');
      else this._emit('error', error);
      throw error;
    }
  }
  _receive(value) {
    const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    this._emit('raw', raw);
    for (const frame of this.decoder.push(raw)) {
      this._emit('data', {...frame, receivedAt: Date.now(), monotonicMs: performance.now()});
    }
  }
  /** Read-only query; does not unlock, calibrate, save, or change sensor settings. */
  async readRegister(register) {
    if (![0x3a, 0x51].includes(register)) throw new RangeError('Supported reads: 0x3A and 0x51.');
    if (this.status !== 'connected' || !this.writer) throw new Error('Connect a sensor with the FFE9 write characteristic first.');
    if (this._reading) throw new Error('A register request is already in progress.');
    this._reading = true;
    try {
      const command = Uint8Array.of(0xff, 0xaa, 0x27, register, 0);
      if (this.writer.properties.write) await this.writer.writeValueWithResponse(command);
      else await this.writer.writeValueWithoutResponse(command);
    } finally { this._reading = false; }
  }
  _cleanup() {
    this._generation++;
    this._attempt?.abort();
    this.characteristic?.removeEventListener('characteristicvaluechanged', this._notify);
    this.device?.removeEventListener('gattserverdisconnected', this._disconnected);
    this.characteristic = null; this.writer = null;
    this.decoder.reset();
  }
  disconnect() {
    const device = this.device;
    this._cleanup();
    this.device = null;
    this._status('disconnected');
    // Also cancel pending connects (connected may still be false). UI state must
    // already be reset even if the platform throws during radio cleanup.
    try { device?.gatt?.disconnect(); }
    catch (error) { this._emit('warning', `Local session closed; Bluetooth cleanup: ${error.message}`); }
  }
}
