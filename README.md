# Rehab exercise toolkit — WIT-Motion connection check

Updated 2026-11-09. Ready for GitHub Pages from `main` → `/docs`. See [DEPLOYMENT.md](DEPLOYMENT.md) for repository connection, HTTPS setup and player checks. Repository: [vsupacha/rehab-exer-toolkit](https://github.com/vsupacha/rehab-exer-toolkit). Enable Pages using the deployment guide.

Buildless JavaScript library and static status page for WT9011DCL-BT50 / WIT BLE 5.0 sensors. Connect two independent sensors, assigned to left and right arms, and display acceleration (g, including gravity), angular velocity (degrees/s), and roll/pitch/yaw (degrees). The original status page remains a raw-signal comparison tool.

The separate Thai game prototype is at `game.html`, linked from the status dashboard. It adds baseline-relative movement extent, driver-controlled mirror visuals, full-cycle counting, phase timings and CSV. Open http://localhost:8000/game.html using the same server. Close other live-sensor pages before connecting. See the deployment guide for hardware checks; the full game design is maintained in the parent Dropbox project, outside this repository. No centimetre distance is calculated; percent is an orientation-derived proxy, which requires a visible angle change at the handle mount.

**Current game (2026-11-09; supersedes the angular description below for sideways/lifting):** one IMU for coupled handles; Connection → Play/High–Low → Start → Photo. Sideways/lifting needs no teaching or calibration. Raw signed acceleration → time-based EMA 50 ms → trailing 10-point OLS slope against browser receipt time, in mg/s. Y defaults for sideways, X for lifting; axis/sign are editable. There is no velocity integration, deadband or adaptive gravity removal in this path. High=200 / Low=50 mg/s are editable defaults, not learned thresholds. Moving starts when |slope|≥High for 150 ms; a bout completes when |slope|≤Low for 200 ms. No sign reversal required; staying between thresholds preserves state. Sign reversal changes only the graph. Play shows state, current bout seconds and completed bouts/goal, with a four-column activity table (side, bout, seconds, peak slope). CSV measurement is slope_activity_bout, without outbound/return timings. Play shows live slope. Manual High/Low can be applied before connecting, during play or while paused; a new pair cancels only the unfinished bout, retains EMA/window history and keeps completed counts/records. Values survive slope reconnects. Start/Resume enters moving immediately with no stationary check or zeroing. The nozzle moves dry while the first nine slope samples are unavailable; watering starts only after valid slope stays within Low for 200ms. The initial movement is assumed from the Start click, marked initial_movement_assumed in CSV. Wrist turning retains angular baseline counting. Signal states still need physical validation: low slope cannot establish handle home or physical zero speed; each count is one movement bout, not a full out-and-back repetition. Physical movement and UI acceptance still need testing on the mounted device.

Game flow: **Settings tab → connect/select task and driver → capture baseline 0% / 100% → Start game → Play tab automatically**. Returning to Settings pauses the current cycle; Resume switches back to Play while retaining baseline and completed reps. End the current session in Play before changing locked configuration. No page navigation or reconnection is needed between tabs. Live game movement still needs physical validation.

Current sideways/lifting flow: Connection → Play to set High/Low below the live graph → Start. Cal is removed from this flow. The same Apply/Enter/default controls work during active or paused play; invalid pairs leave both applied values unchanged. Wrist turning retains its angular baseline.

Watering reward: the nozzle moves dry at half its previous speed (4.4-second sweep). When resting/watering over a plant, collect that exact plant once and remove its glyph from the fixed planting slot. Watering empty soil earns nothing. Game goals count collected plants; movement timing/CSV remains a separate count. A cleared row refills on the next movement when a larger goal needs more plants. Achievement PNGs show the actual earned plants.

Latest update: count thresholds are configurable (default target 75%, return <=25%), continuous motion does not require a target hold, and return overshoot below zero no longer blocks home confirmation. Main progress is displayed at least 0%; signed values remain in diagnostic details. Settings now also has an End current session action.

Camera: click Open camera in Settings and permit it in the browser. Capture the endpoint or use the manual snapshot button; during a game the highest sampled driver excursion is retained on return. View photo switches to a third tab with the latest full-frame photo over the garden scene. Switching away from Play pauses scoring. No microphone, uploads, photo persistence or pose inference; stop camera releases its tracks. Real camera/IMU acceptance remains pending; 26 automated checks pass.

Shareable achievement image: after completing the goal and taking a photo, the Photo tab generates a flattened 1600×900 PNG. Click **ดาวน์โหลดภาพรวม PNG** to save `arm-booster-achievement.png` for sending yourself. The preview is this same single PNG, including garden artwork, goal/flowers and the photo gimmick. Demo output is visibly labeled; no automatic sharing/upload occurs. Three additional compositor tests pass, and the browser fixture verified a generated PNG using a synthetic photo.

## Two-arm comparison

1. Refresh the page with Ctrl+Shift+R. Connect **Left arm**, then **Right arm**, selecting a distinct sensor for each. Browser IDs distinguish identically named sensors; these IDs are not Bluetooth MAC addresses. The second selection rejects a sensor already assigned to the other arm before touching its GATT connection.
2. Mount both sensors consistently and choose X/Roll, Y/Pitch or Z/Yaw for the shared graph. Full raw values stay visible in each arm's card.
3. Hold both arms in the intended starting pose and click **Set both neutral**. This subtracts each sensor's own initial Euler angles. **Reverse comparison direction** changes the selected comparison axis sign for that arm if mounting directions are opposite. These controls do not alter raw readings or send sensor commands.
4. Compare the selected angles and wrapped signed left-minus-right difference. **Use raw angles** clears neutral offsets. Starting a new connection clears both offsets. Reference/sign changes clear graph history to avoid mixing references. Disconnect and diagnostics operate independently for each arm.

The two streams use browser receipt timestamps, not synchronized sensor clocks. Numeric comparison requires both samples to be at most 500 ms old and their receipt timestamps to differ by at most 150 ms; otherwise values pause at dashes. This is a preliminary sensor-axis comparison, not an anatomical joint angle, calibrated 3D relative orientation, or clinical symmetry measure. **Try two-arm demo** simulates both streams, with a small phase/amplitude difference. Live connections and demo are mutually exclusive.

## Launch

From this repository folder:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Open http://localhost:8000 in current desktop Chrome or Edge. Do not double-click `index.html`: ES modules and Bluetooth require a served page. Enable PC Bluetooth, power the sensor, close competing sensor apps, then click **Scan & connect** and select it. Web Bluetooth uses the browser chooser; websites cannot silently enumerate nearby devices. If the filtered chooser misses a renamed sensor, enable **Show all Bluetooth devices**. Reconnect by scanning again after disconnect.

**Try two-arm demo** previews simulated motion without Bluetooth. It does not prove two-device hardware compatibility.

## GitHub Pages (no build)

Upload/push the contents of this `rehab-exer-toolkit` folder as a repository. In GitHub **Settings → Pages**, choose **Deploy from a branch**, select your branch and **/docs**, then Save. The page will be at `https://<owner>.github.io/<repository>/`. All asset paths are relative, so project subpaths work. No npm installation, backend, CDN, or Actions workflow is required. `docs/.nojekyll` bypasses Jekyll. The project repository is vsupacha/rehab-exer-toolkit; keep using its main branch and /docs publishing source.

## Files

```text
docs/
  index.html            Status dashboard / Pages entry
  .nojekyll
  assets/app.js         Dashboard and demo
  assets/style.css
  lib/witmotion.js      Reusable BLE client and pure packet decoder
  lib/comparison.js     Angle wrapping, offsets, freshness/skew checks
tests/*.test.js          Node built-in tests; no dependencies
tools/diagnose_ble.py    Optional native Windows BLE comparison
```

## Library usage

```js
import {WitMotion} from './lib/witmotion.js';
const sensor = new WitMotion();
sensor.addEventListener('data', ({detail}) => {
  if (detail.type === 'motion') {
    console.log(detail.acceleration, detail.angularVelocity, detail.angles);
  }
});
sensor.addEventListener('status', ({detail}) => console.log(detail.state));
sensor.addEventListener('error', ({detail}) => console.error(detail));
sensor.addEventListener('warning', ({detail}) => console.warn(detail));
connectButton.onclick = () => sensor.connect().catch(console.error);
disconnectButton.onclick = () => sensor.disconnect();
// Optional read-only requests after connection; listen for the corresponding data event.
// await sensor.readRegister(0x51); // quaternion [w,x,y,z]
// await sensor.readRegister(0x3a); // magnetic raw counts [x,y,z]
```

`data` includes `type`, `raw` bytes, host `receivedAt` (epoch ms), and host `monotonicMs` (performance clock). These are browser receipt times, not sensor sample timestamps. Register replies arrive separately; fields are never presented as a synchronized nine-axis sample. `raw` events expose each notification's Uint8Array. `status` transitions are disconnected → selecting → connecting → connected. Connected means notifications enabled, not that valid data has arrived. The two-arm dashboard flags motion data older than 500 ms as stale; displayed rate is decoded motion frames over a rolling 3-second window, not the configured sensor rate or radio packet-loss rate.

## Protocol evidence and limits

Protocol checked on 2026-11-03 against the manufacturer's [official BLE SDK](https://github.com/WITMOTION/WitBluetooth_BWT901BLE5_0), specifically [device_model.py](https://github.com/WITMOTION/WitBluetooth_BWT901BLE5_0/blob/803c1a815d8f144c983e28309d4f3665e89d3df9/Python/BWT901BLE5.0_python_sdk/device_model.py). The [product page](https://www.wit-motion.com/index.php/WirelessInclinometer/17.html) identifies WT9011DCL-BT50; the user's WT901BLE67 motion stream has now been verified by native Windows capture and successful single-sensor web use.

- Full vendor UUIDs: service `0000ffe5-0000-1000-8000-00805f9a34fb`, notify `0000ffe4-0000-1000-8000-00805f9a34fb`, write `0000ffe9-0000-1000-8000-00805f9a34fb`. Preserve these exact strings.
- `55 61`: 20 bytes; nine signed little-endian int16 fields from offset 2: acceleration ×16/32768 g, angular velocity ×2000/32768 degrees/s, angles ×180/32768 degrees.
- `55 71`: 20-byte register response; register address in bytes 2–3. Quaternion at 0x51: four int16 values from byte 4, divided by 32768. Magnetic at 0x3A: three signed raw counts from byte 4; model-specific physical units intentionally not inferred.
- Read command `FF AA 27 <register> 00`. Only 0x3A and 0x51 register reads are exposed. Explicit game buttons may request output rate 10Hz (FF AA 03 06 00) or 50Hz (FF AA 03 08 00); no automatic calibration, unlocking or save command is sent.
- Decoder buffers fragmented notifications, handles coalesced frames and skips noise/unknown headers. This 20-byte format has no checksum in the reference SDK; arbitrary corruption inside a frame cannot be reliably detected. Legacy UART `55 51/52/53` packets and other WIT protocols are not supported.
- Browser support depends on OS/browser/radio. Use HTTPS (Pages provides it) or localhost. Embedded/in-app browsers, Firefox and Safari may lack Web Bluetooth; the dashboard reports API availability, not a guaranteed working radio.
- No data is uploaded or persisted by either page. The game offers an explicit local CSV download of completed reps, including demo/live provenance. No accounts or analytics.

## Checks

Hardware evidence (2026-11-03): the user ran the native Windows diagnostic against WT901BLE67 and reported 51 notifications in five seconds, with FFE5/FFE4/FFE9 confirmed. A received `55 61` packet is included in the decoder tests. Earlier Windows WinRT 0x800106D9 failures stopped after the service repair instructions; the user subsequently confirmed the single-sensor web page worked. Two-sensor simultaneous physical acceptance remains pending.

`tools/diagnose_ble.py --address <Bluetooth-address>` provides a native Windows/Bleak comparison: scans, connects, lists characteristics, and receives notifications for five seconds. It never writes configuration or requests bonding. Requires Bleak and its Windows dependencies; the project-root `Test-Ble.ps1` launcher can reuse packages from the existing Pressure Sensing Dev reference project on this PC. Run in the normal signed-in user's PowerShell. An agent-context WinRT error does not establish a browser or hardware fault. `--address-type random` is an optional separate Windows address-type comparison, not a browser fix.

On a different PC, the reference packages may be absent or incompatible. For an independent diagnostic environment, create a local virtual environment **outside Dropbox** (for example `$env:LOCALAPPDATA\RehabExerToolkit\ble-venv`), install Bleak there using that environment's `python -m pip install bleak`, and invoke `tools/diagnose_ble.py` with its Python directly. The browser dashboard and local HTTP server do not require Bleak. Keep device addresses as local command arguments, not in shared files.

Connection troubleshooting: a `NetworkError` at **Connecting to sensor GATT** occurs before service discovery or motion decoding. Selecting/pairing in the browser chooser alone does not establish a GATT connection. Close other browser tabs and vendor/mobile apps that may hold the sensor connection; power-cycle the sensor and retry from one browser. The dashboard now logs each GATT stage, applies a 15-second timeout to each operation, and allows Disconnect to cancel a pending connection immediately. It does not automatically retry or change Windows pairing settings. Use Ctrl+Shift+R after an update to reload the page.

Run `npm test` or `node --test tests/*.test.js` with Node 22+. Tests cover scaling/signs, single-split boundaries, noise, DataView offsets, register responses, BLE lifecycle/timeouts/cancellation, duplicate-device rejection, independent dual clients, neutral/sign/wrap comparison, and stale/skew rejection. The user confirmed the single-sensor browser reads successfully. Simultaneous two-sensor hardware acceptance remains pending: connect both, move only one arm to confirm assignment, move both, disconnect one and verify the other keeps updating, reconnect, and set neutral again. Quaternion/magnetic reads also need physical verification.
