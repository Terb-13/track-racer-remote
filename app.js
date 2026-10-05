(function () {
  const P = window.TRP, E = P.enc;
  const DEMO = new URLSearchParams(location.search).get('demo') === '1';
  const $ = s => document.querySelector(s);
  const LANE_STEP = 44.5, LANE_MAX = 68, UNKNOWN_OFFSET = 1000;
  const cars = new Set();
  $('#mode').textContent = DEMO ? '🧪 Demo mode (simulated cars)' : '📶 Bluetooth mode';

  function notice(html) { const n = $('#notice'); n.innerHTML = html; n.hidden = !html; }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2200); }
  const speedWord = v => v <= 0 ? 'Stopped' : v <= 400 ? 'Slow' : v <= 800 ? 'Medium' : 'Fast';
  const hasBT = !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
  const demoLink = ' (Or try <a href="?demo=1" style="color:#ffb000">demo mode</a>.)';
  async function checkBluetooth() {
    if (DEMO) return true;
    if (!hasBT) {
      notice('⚠️ This browser can’t talk to Bluetooth cars (Safari and iPhone/iPad browsers don’t support it).<br><b>Open this page in Google Chrome on the Mac.</b>' + demoLink);
      $('#connect').disabled = true; return false;
    }
    let avail = true;
    try { if (navigator.bluetooth.getAvailability) avail = await navigator.bluetooth.getAvailability(); } catch (e) {}
    if (!avail) {
      notice('⚠️ Bluetooth looks switched off. <b>Turn on Bluetooth</b> in System Settings &gt; Bluetooth, then press Find &amp; Connect again.' + demoLink);
      return false;
    }
    notice(''); return true;
  }
  checkBluetooth();
  if (hasBT && navigator.bluetooth.addEventListener) navigator.bluetooth.addEventListener('availabilitychanged', checkBluetooth);

  // ---- Web Bluetooth transport ----
  class BleTransport {
    constructor(device) { this.device = device; this.name = device.name || ''; this.id = device.id; this.modelId = null;
      this.q = Promise.resolve(); this.onDisconnect = null; this.cbs = [];
      device.addEventListener('gattserverdisconnected', () => this.onDisconnect && this.onDisconnect()); }
    async connect() {
      this.server = await this.device.gatt.connect();
      const svc = await this.server.getPrimaryService(P.SERVICE);
      this.rx = await svc.getCharacteristic(P.READ_CHR);
      this.tx = await svc.getCharacteristic(P.WRITE_CHR);
      this.rx.addEventListener('characteristicvaluechanged', e => {
        const v = e.target.value; const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
        this.cbs.forEach(cb => cb(u)); });
      await this.rx.startNotifications();
    }
    onNotify(cb) { this.cbs.push(cb); }
    write(bytes) { // serialize GATT writes; Chrome rejects overlapping operations
      this.q = this.q.catch(() => {}).then(() => this.tx.writeValueWithResponse
        ? this.tx.writeValueWithResponse(bytes) : this.tx.writeValue(bytes));
      return this.q; }
    async disconnect() { try { await this.write(E.disconnect()); } catch (e) {}
      setTimeout(() => { try { this.device.gatt.disconnect(); } catch (e) {} }, 300); }
    async readAdvert(timeoutMs = 2500) { // optional: model ID from manufacturer data (Chrome may not support)
      if (!this.device.watchAdvertisements) return;
      const ctl = new AbortController();
      await new Promise(res => {
        const t = setTimeout(res, timeoutMs);
        this.device.addEventListener('advertisementreceived', ev => {
          const md = ev.manufacturerData && (ev.manufacturerData.get(0xBEEF) || ev.manufacturerData.get(0xEFBE));
          if (md && md.byteLength > 1) this.modelId = md.getUint8(1);
          if (ev.name) this.name = ev.name;
          clearTimeout(t); res(); }, { once: true });
        this.device.watchAdvertisements({ signal: ctl.signal }).catch(() => { clearTimeout(t); res(); });
      });
      ctl.abort();
    }
  }

  function guessModel(t) {
    if (t.modelId != null && P.MODELS[t.modelId]) return `${P.MODELS[t.modelId]} (model ${t.modelId})`;
    const n = (t.name || '').toLowerCase();
    if (n.includes('skull')) return 'Skull'; if (n.includes('shock')) return 'Ground Shock';
    return t.modelId != null ? `model ${t.modelId}` : 'model unknown';
  }

  // ---- Car card ----
  class Car {
    constructor(t) {
      this.t = t; this.offset = null; this.head = false; this.tail = false; this.transitions = 0;
      const el = $('#card-tpl').content.firstElementChild.cloneNode(true); this.el = el;
      const q = s => el.querySelector(s); this.q = q;
      $('#empty').hidden = true; $('#cars').appendChild(el);
      q('.speed').addEventListener('input', () => { q('.speed-val').textContent = speedWord(+q('.speed').value); this.throttle(); });
      q('.stop').onclick = () => { clearTimeout(this.th); this.zeroSpeed(); this.send(E.setSpeed(0, 1500)); toast('⛔ Stopped'); };
      q('.lane-left').onclick = () => this.lane(-1); q('.lane-right').onclick = () => this.lane(1);
      q('.uturn').onclick = () => { this.send(E.turn(3, 0)); toast('↩️ U-turn sent to ' + (this.t.name || 'car')); };
      q('.head').onclick = () => { this.head = !this.head; q('.head').classList.toggle('on', this.head);
        this.send(E.setLights(E.lightMask(P.LIGHT.HEAD, this.head))); };
      q('.tail').onclick = () => { this.tail = !this.tail; q('.tail').classList.toggle('on', this.tail);
        this.send(E.setLights(E.lightMask(P.LIGHT.BRAKE, this.tail))); };
      q('.color').onchange = () => { const c = q('.color').value; this.color(c);
        q('.color-state').textContent = 'Colour: ' + c; toast('🎨 Colour: ' + c); };
      q('.disc').onclick = () => this.t.disconnect();
      t.onNotify(b => this.onMsg(b));
      t.onDisconnect = () => this.lost();
    }
    zeroSpeed() { const q = this.q; this.stoppedAt = Date.now(); q('.speed').value = 0;
      q('.speed-val').textContent = 'Stopped'; q('.rspeed').textContent = 'Stopped'; q('.mms').textContent = '0'; }
    log(s) { const l = this.q('.log'); l.textContent = (s + '\n' + l.textContent).slice(0, 4000); }
    hex(b) { return Array.from(b, x => x.toString(16).padStart(2, '0')).join(' '); }
    send(b) { this.log('→ ' + this.hex(b)); return this.t.write(b).catch(e => this.log('write failed: ' + e.message)); }
    throttle() { clearTimeout(this.th); this.th = setTimeout(() => this.send(E.setSpeed(+this.q('.speed').value, 800)), 80); }
    async start() {
      this.q('.name').textContent = this.t.name || 'Car';
      await this.t.connect();
      cars.add(this);
      this.el.classList.add('connected'); this.q('.state').textContent = '✅ connected';
      await this.send(E.sdkMode(true, 0x01));          // SDK mode + OVERRIDE_LOCALIZATION
      await this.send(E.setConfig(+$('#track').value)); // plastic vs vinyl
      await this.send(E.setOffset(0));                 // so lane changes have a reference
      await this.send(E.version());
      await this.send(E.battery());
      this.poll = setInterval(() => this.send(E.battery()), 10000);
      if (this.t.readAdvert) this.t.readAdvert().then(() => this.showModel());
      this.showModel();
    }
    showModel() { this.q('.model').textContent = guessModel(this.t); if (this.t.name) this.q('.name').textContent = this.t.name; }
    lane(dir) {
      const cur = (this.offset == null || Math.abs(this.offset) > UNKNOWN_OFFSET) ? 0 : this.offset;
      const target = Math.max(-LANE_MAX, Math.min(LANE_MAX, cur + dir * LANE_STEP));
      this.send(E.setOffset(cur)); this.send(E.changeLane(target, 300, 300));
    }
    color(c) {
      const C = P.CHANNEL, X = P.EFFECT;
      const s = (ch, v) => ({ channel: ch, effect: X.STEADY, start: v, end: v, cyclesPerMin: 0 });
      const map = { red: [s(C.RED, 14), s(C.GREEN, 0), s(C.BLUE, 0)], green: [s(C.RED, 0), s(C.GREEN, 14), s(C.BLUE, 0)],
        blue: [s(C.RED, 0), s(C.GREEN, 0), s(C.BLUE, 14)], purple: [s(C.RED, 10), s(C.GREEN, 0), s(C.BLUE, 14)],
        off: [s(C.RED, 0), s(C.GREEN, 0), s(C.BLUE, 0)],
        rainbow: [{ channel: C.RED, effect: X.THROB, start: 0, end: 14, cyclesPerMin: 60 },
                  { channel: C.GREEN, effect: X.THROB, start: 0, end: 14, cyclesPerMin: 90 },
                  { channel: C.BLUE, effect: X.THROB, start: 0, end: 14, cyclesPerMin: 120 }] };
      if (map[c]) this.send(E.lightsPattern(map[c]));
    }
    onMsg(b) {
      const m = P.decode(b); const q = this.q;
      if (m.type !== 'position') this.log('← ' + this.hex(b) + ' ' + m.type);
      switch (m.type) {
        case 'position': this.offset = m.offset; q('.piece').textContent = m.pieceId; q('.loc').textContent = m.locationId;
          q('.offset').textContent = Math.abs(m.offset) > UNKNOWN_OFFSET ? '?' : m.offset.toFixed(1) + ' mm';
          if (!(this.stoppedAt && Date.now() - this.stoppedAt < 1500 && +q('.speed').value === 0)) {
            q('.rspeed').textContent = speedWord(+q('.speed').value === 0 ? 0 : m.speed); q('.mms').textContent = m.speed; }
          q('.ontrack').textContent = 'yes'; break;
        case 'transition': this.transitions++; q('.trans').textContent = this.transitions;
          if (Math.abs(m.offset) < UNKNOWN_OFFSET) this.offset = m.offset; break;
        case 'offset': this.offset = m.offset; break;
        case 'battery': q('.battery').textContent = `${P.batteryPct(m.mv)}%`; q('.volts').textContent = (m.mv / 1000).toFixed(2) + ' V'; break;
        case 'version': q('.fw').textContent = m.version + ' (0x' + m.version.toString(16) + ')'; break;
        case 'delocalized': q('.ontrack').textContent = '❌ lost track'; q('.piece').textContent = '–'; q('.loc').textContent = '–'; break;
        case 'status': q('.ontrack').textContent = m.onCharger ? '🔌 charger' : (m.onTrack ? 'yes' : 'no'); break;
      }
    }
    lost() {
      clearInterval(this.poll); cars.delete(this);
      this.el.classList.remove('connected'); this.el.classList.add('lost');
      this.q('.state').textContent = '🔌 disconnected';
      this.el.querySelectorAll('button,input,select').forEach(x => x.disabled = true);
      this.q('.speed').value = 0; this.q('.speed-val').textContent = '–';
      this.el.querySelectorAll('.stats b').forEach(b => b.textContent = '–');
      this.q('.color-state').textContent = 'Colour: –';
      const rm = document.createElement('button'); rm.textContent = 'Remove (you can reconnect anytime)'; rm.className = 'big';
      rm.onclick = () => { this.el.remove(); if (!document.querySelector('.card')) $('#empty').hidden = false; };
      this.q('.disc').replaceWith(rm);
    }
  }

  $('#track').onchange = () => { cars.forEach(c => c.send(E.setConfig(+$('#track').value)));
    toast('🛣️ Track type: ' + $('#track').selectedOptions[0].textContent + (cars.size ? ' (sent to ' + cars.size + ' car' + (cars.size > 1 ? 's' : '') + ')' : '')); };

  $('#connect').onclick = async () => {
    if (!(await checkBluetooth())) return;
    let t;
    try {
      if (DEMO) t = new window.MockTransport();
      else {
        const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [P.SERVICE] }],
          optionalManufacturerData: [0xBEEF, 0xEFBE] }).catch(e => {
            if (/optionalManufacturerData/.test(e.message)) return navigator.bluetooth.requestDevice({ filters: [{ services: [P.SERVICE] }] });
            throw e; });
        t = new BleTransport(dev);
      }
      const car = new Car(t);
      try { await car.start(); } catch (e) { car.lost(); throw e; }
    } catch (e) {
      if (e.name === 'NotFoundError') notice('No car chosen. Make sure the car is switched on and off its charger, then try again.');
      else notice('Couldn’t connect: ' + e.message + '. Turn the car off and on, then try again.');
    }
  };
  window.__trr = { cars };
})();
