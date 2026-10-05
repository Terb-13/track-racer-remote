// Simulated car for ?demo=1 — speaks the same byte protocol as a real car.
(function () {
  const P = window.TRP;
  const LOOP = [33, 36, 39, 17, 18, 40, 48, 20, 23, 34];
  let count = 0;
  class MockTransport {
    constructor() {
      const models = [[9, 'Skull'], [8, 'Ground Shock']];
      const [modelId, nm] = models[count++ % 2];
      this.name = nm + ' (demo)'; this.modelId = modelId; this.id = 'demo-' + count;
      this.speed = 0; this.offset = 654321; this.sdk = false; this.idx = 0; this.dist = 0; this.mv = 3950;
      this.listeners = []; this.onDisconnect = null; this.closed = false;
    }
    async connect() { await new Promise(r => setTimeout(r, 300));
      this.timer = setInterval(() => this.tick(), 100);
      setTimeout(() => this.emit([5, 0x3f, 1, 0, 0, 0]), 200); }
    onNotify(cb) { this.listeners.push(cb); }
    emit(arr) { const u = new Uint8Array(arr); this.listeners.forEach(cb => cb(u)); }
    f32(v) { return Array.from(new Uint8Array(new Float32Array([v]).buffer)); }
    u16(v) { return [v & 255, (v >> 8) & 255]; }
    async write(b) {
      if (this.closed) throw new Error('disconnected');
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      switch (b[1]) {
        case P.MSG.SDK_MODE: this.sdk = !!b[2]; break;
        case P.MSG.SET_SPEED: this.speed = this.sdk ? Math.max(0, dv.getInt16(2, true)) : 0; break;
        case P.MSG.SET_OFFSET: this.offset = dv.getFloat32(2, true); break;
        case P.MSG.CHANGE_LANE: if (this.speed > 0 && this.offset !== 654321) this.target = dv.getFloat32(6, true); break;
        case P.MSG.BATTERY: this.mv = Math.max(3400, this.mv - 5); setTimeout(() => this.emit([3, 0x1b, ...this.u16(this.mv)]), 30); break;
        case P.MSG.VERSION: setTimeout(() => this.emit([3, 0x19, ...this.u16(0x2e5a)]), 30); break;
        case P.MSG.DISCONNECT: this.close(); break;
      }
    }
    tick() {
      if (this.target !== undefined) { const s = Math.sign(this.target - this.offset);
        this.offset += s * Math.min(6, Math.abs(this.target - this.offset));
        if (this.offset === this.target) this.target = undefined; }
      if (!this.speed) return;
      this.dist += this.speed / 10;
      const loc = Math.floor(this.dist / 187) % 3;
      if (this.dist >= 560) { this.dist -= 560; const prev = this.idx; this.idx = (this.idx + 1) % LOOP.length;
        this.emit([17, 0x29, this.idx, prev, ...this.f32(this.offset), 0, 0, 0, 0, 0, 0, 0, 0, 56, 56]); }
      if (Math.random() < 0.4) this.emit([16, 0x27, loc + 3 * Math.round(((this.offset === 654321 ? 0 : this.offset) + 68) / 45), LOOP[this.idx],
        ...this.f32(this.offset), ...this.u16(this.speed), 0, 0, 0, 0, 0, ...this.u16(this.speed)]);
    }
    close() { if (this.closed) return; this.closed = true; clearInterval(this.timer); this.onDisconnect && this.onDisconnect(); }
    async disconnect() { this.close(); }
  }
  window.MockTransport = MockTransport;
})();
