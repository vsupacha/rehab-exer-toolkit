import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WitMotionDecoder, WitMotion, UUID} from '../docs/lib/witmotion.js';

function motion() {
  const bytes = new Uint8Array(20); bytes.set([0x55, 0x61]);
  const v = new DataView(bytes.buffer);
  [2048, -2048, 0, 16384, -16384, 0, 16384, -16384, -32768].forEach((n, i) => v.setInt16(2 + i * 2, n, true));
  return bytes;
}
test('real WT901BLE67 notification reported from Windows decodes expected angles', () => {
  const bytes = Uint8Array.from(Buffer.from('55611503c904c705000000000000b60734f1baeb', 'hex'));
  const [frame] = new WitMotionDecoder().push(bytes);
  assert.equal(frame.type, 'motion');
  assert.deepEqual(frame.angles.map(value => Number(value.toFixed(3))), [10.844, -20.808, -28.51]);
  assert.deepEqual(frame.angularVelocity, [0, 0, 0]);
});
test('signed little-endian values and physical scales', () => {
  const [f] = new WitMotionDecoder().push(motion());
  assert.deepEqual(f.acceleration, [1, -1, 0]);
  assert.deepEqual(f.angularVelocity, [1000, -1000, 0]);
  assert.deepEqual(f.angles, [90, -90, -180]);
});
test('arbitrary notification splits, coalescing, and leading noise', () => {
  const input = Uint8Array.from([0x55, 0, 7, ...motion(), ...motion()]);
  for (let split = 0; split <= input.length; split++) {
    const d = new WitMotionDecoder();
    const frames = [...d.push(input.slice(0, split)), ...d.push(input.slice(split))];
    assert.equal(frames.length, 2); assert.equal(d.buffer.length, 0);
  }
});
test('DataView offsets are respected and incomplete data resets between sessions', () => {
  const bytes = Uint8Array.from([9, ...motion(), 8]);
  const d = new WitMotionDecoder();
  assert.equal(d.push(new DataView(bytes.buffer, 1, 20)).length, 1);
  d.push(motion().slice(0, 8)); d.reset();
  assert.equal(d.push(motion()).length, 1);
});
test('quaternion and magnetic register responses; unknown registers stay unknown', () => {
  const bytes = new Uint8Array(20); bytes.set([0x55, 0x71, 0x51, 0]);
  const v = new DataView(bytes.buffer); v.setInt16(4, 16384, true); v.setInt16(6, -16384, true);
  const d = new WitMotionDecoder();
  assert.deepEqual(d.push(bytes)[0].quaternion, [.5, -.5, 0, 0]);
  bytes[2] = 0x3a; assert.deepEqual(d.push(bytes)[0].magneticRaw, [16384, -16384, 0]);
  bytes[2] = 0xff; assert.equal(d.push(bytes)[0].type, 'unknown');
});
test('BLE lifecycle subscribes, reads only supported registers, and cleans up', async () => {
  globalThis.isSecureContext = true;
  const notify = new EventTarget(); notify.startNotifications = async () => {};
  let command;
  const writer = {properties: {write: true}, writeValueWithResponse: async bytes => { command = [...bytes]; }};
  const service = {getCharacteristic: async uuid => uuid === UUID.notify ? notify : writer};
  const device = new EventTarget(); device.name = 'WT901';
  device.gatt = {connected: false, connect: async () => { device.gatt.connected = true; return {getPrimaryService: async () => service}; }, disconnect: () => { device.gatt.connected = false; }};
  const client = new WitMotion({bluetooth: {requestDevice: async options => { assert.ok(options.optionalServices.includes(UUID.service)); return device; }}});
  const states = []; client.addEventListener('status', e => states.push(e.detail.state));
  let frame; client.addEventListener('data', e => { frame = e.detail; });
  await client.connect();
  notify.value = new DataView(motion().buffer); notify.dispatchEvent(new Event('characteristicvaluechanged'));
  assert.equal(frame.type, 'motion');
  await client.readRegister(0x51); assert.deepEqual(command, [255, 170, 39, 81, 0]);
  await assert.rejects(client.readRegister(0x69), RangeError);
  client.disconnect(); assert.equal(device.gatt.connected, false); assert.equal(client.writer, null);
  assert.deepEqual(states, ['selecting', 'connecting', 'connected', 'disconnected']);
});

function mockClient(connect, disconnect = () => {}, timeoutMs = 30) {
  globalThis.isSecureContext = true;
  const device = new EventTarget(); device.name = 'WT901';
  device.gatt = {connected: false, connect, disconnect};
  return new WitMotion({timeoutMs, bluetooth: {requestDevice: async () => device}});
}
test('GATT rejection identifies failed stage and restores disconnected state', async () => {
  const client = mockClient(async () => { throw new DOMException('Connection attempt failed.', 'NetworkError'); });
  await assert.rejects(client.connect(), {name: 'NetworkError', message: 'Connecting to sensor GATT: Connection attempt failed.'});
  assert.equal(client.status, 'disconnected');
});
test('hung GATT connection times out, then allows another attempt', async () => {
  const client = mockClient(() => new Promise(() => {}), undefined, 10);
  await assert.rejects(client.connect(), {name: 'TimeoutError'});
  assert.equal(client.status, 'disconnected');
  await assert.rejects(client.connect(), {name: 'TimeoutError'});
});
test('disconnect cancels pending GATT immediately even when platform cleanup throws', async () => {
  let resolveConnect;
  const client = mockClient(() => new Promise(resolve => { resolveConnect = resolve; }), () => { throw new Error('radio busy'); }, 1000);
  const pending = client.connect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.status, 'connecting');
  client.disconnect();
  assert.equal(client.status, 'disconnected');
  await pending;
  resolveConnect({getPrimaryService: () => { throw new Error('Cancelled attempt must not discover services'); }});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.status, 'disconnected'); assert.equal(client.writer, null);
});
test('hung service discovery has its own timeout and stage label', async () => {
  const client = mockClient(async () => ({getPrimaryService: () => new Promise(() => {})}), undefined, 10);
  await assert.rejects(client.connect(), error => error.name === 'TimeoutError' && error.message.includes('FFE5'));
  assert.equal(client.status, 'disconnected');
});

test('same device cannot be assigned to both arms and existing connection is untouched', async () => {
  globalThis.isSecureContext = true;
  const device = new EventTarget(); device.id = 'already-in-left';
  let touched = false;
  device.gatt = {connect: () => { touched = true; }, disconnect: () => { touched = true; }};
  const right = new WitMotion({bluetooth: {requestDevice: async () => device}});
  await assert.rejects(right.connect({excludedDeviceIds: ['already-in-left']}), {name: 'InvalidStateError'});
  assert.equal(touched, false); assert.equal(right.status, 'disconnected');
});
test('two clients keep streams independent and disconnecting left preserves right', async () => {
  globalThis.isSecureContext = true;
  const make = id => {
    const notify = new EventTarget(); notify.startNotifications = async () => {};
    const writer = {properties: {write: true}, writeValueWithResponse: async () => {}};
    const service = {getCharacteristic: async uuid => uuid === UUID.notify ? notify : writer};
    const device = new EventTarget(); device.id = id; device.name = 'WT901BLE67';
    device.gatt = {connected: false, connect: async () => { device.gatt.connected = true; return {getPrimaryService: async () => service}; }, disconnect: () => { device.gatt.connected = false; }};
    return {notify, device, client: new WitMotion({bluetooth: {requestDevice: async () => device}})};
  };
  const left = make('left'), right = make('right');
  let l = 0, r = 0;
  left.client.addEventListener('data', () => l++); right.client.addEventListener('data', () => r++);
  await left.client.connect(); await right.client.connect({excludedDeviceIds: ['left']});
  const send = side => { side.notify.value = new DataView(motion().buffer); side.notify.dispatchEvent(new Event('characteristicvaluechanged')); };
  send(left); send(right); assert.deepEqual([l, r], [1, 1]);
  left.client.disconnect(); send(left); send(right);
  assert.deepEqual([l, r], [1, 2]); assert.equal(right.device.gatt.connected, true);
  assert.equal(right.client.status, 'connected'); right.client.disconnect();
});
