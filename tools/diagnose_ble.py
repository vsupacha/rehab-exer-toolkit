"""Read-only Windows BLE comparison with browser GATT (requires bleak).

No bonding, settings writes, firmware changes, or automatic retries.
Example: python tools/diagnose_ble.py --address XX:XX:XX:XX:XX:XX
Optional Windows comparison: --address-type random
"""
import argparse
import asyncio
import json
import struct
import time
from bleak import BleakClient, BleakScanner

SERVICE = '0000ffe5-0000-1000-8000-00805f9a34fb'
NOTIFY = '0000ffe4-0000-1000-8000-00805f9a34fb'

async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--address', required=True)
    parser.add_argument('--address-type', choices=['public', 'random'])
    args = parser.parse_args()
    stage = 'scan'
    started = time.monotonic()
    print('Scanning for selected sensor (10 s maximum)…', flush=True)
    try:
        device = await BleakScanner.find_device_by_address(args.address, timeout=10)
        if device is None:
            print(json.dumps({'stage': stage, 'result': 'not_found'})); return 1
        print(f'Advertisement found: {device.name}; connecting via Windows WinRT…', flush=True)
        stage = 'connect_and_discover'
        options = {'address_type': args.address_type} if args.address_type else {}
        async with BleakClient(device, timeout=15, winrt=options) as client:
            services = [{'uuid': s.uuid, 'characteristics': [
                {'uuid': c.uuid, 'properties': c.properties} for c in s.characteristics
            ]} for s in client.services]
            print(json.dumps({'stage': 'services', 'services': services}), flush=True)
            stage = 'subscribe'
            count = 0
            def receive(_, data):
                nonlocal count
                count += 1
                if count <= 3:
                    row = {'notification': count, 'hex': bytes(data).hex()}
                    if len(data) == 20 and data[:2] == b'\x55\x61':
                        values = struct.unpack('<9h', data[2:])
                        row['angles_deg'] = [round(v * 180 / 32768, 3) for v in values[6:]]
                    print(json.dumps(row), flush=True)
            await client.start_notify(NOTIFY, receive)
            stage = 'notifications'
            await asyncio.sleep(5)
            await client.stop_notify(NOTIFY)
            print(json.dumps({'result': 'connected', 'notification_count': count}), flush=True)
            return 0 if count else 2
    except Exception as error:
        print(json.dumps({'result': 'failed', 'stage': stage, 'error_type': type(error).__name__,
                          'error': str(error), 'elapsed_s': round(time.monotonic() - started, 1),
                          'address_type': args.address_type or 'automatic'}), flush=True)
        return 1

if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
