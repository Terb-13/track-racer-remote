// Vehicle message encoders/decoders, per the Apache-2.0 drive-sdk protocol.h (little-endian, packed).
(function (root) {
  const SERVICE = 'be15beef-6186-407e-8381-0bd89c4d8df4';
  const READ_CHR = 'be15bee0-6186-407e-8381-0bd89c4d8df4';
  const WRITE_CHR = 'be15bee1-6186-407e-8381-0bd89c4d8df4';
  const MSG = {
    DISCONNECT: 0x0d, PING: 0x16, PING_RESP: 0x17, VERSION: 0x18, VERSION_RESP: 0x19,
    BATTERY: 0x1a, BATTERY_RESP: 0x1b, SET_LIGHTS: 0x1d, SET_SPEED: 0x24, CHANGE_LANE: 0x25,
    CANCEL_LANE: 0x26, POSITION: 0x27, TRANSITION: 0x29, INTERSECTION: 0x2a, DELOCALIZED: 0x2b,
    SET_OFFSET: 0x2c, OFFSET_UPDATE: 0x2d, TURN: 0x32, LIGHTS_PATTERN: 0x33, SPEED_UPDATE: 0x36,
    STATUS: 0x3f, SET_CONFIG: 0x45, COLLISION: 0x4d, SDK_MODE: 0x90,
  };
  const LIGHT = { HEAD: 0, BRAKE: 1, FRONT: 2, ENGINE: 3 };
  const CHANNEL = { RED: 0, TAIL: 1, BLUE: 2, GREEN: 3, FRONTL: 4, FRONTR: 5 };
  const EFFECT = { STEADY: 0, FADE: 1, THROB: 2, FLASH: 3, RANDOM: 4 };
  const MATERIAL = { PLASTIC: 0, VINYL: 1 };
  // Model IDs from the advertisement manufacturer data (community tables).
  const MODELS = { 1: 'Kourai', 2: 'Boson', 3: 'Rho', 4: 'Katal', 5: 'Hadion', 6: 'Spektrix', 7: 'Corax',
    8: 'Ground Shock', 9: 'Skull', 10: 'Thermo', 11: 'Nuke', 12: 'Guardian', 14: 'Big Bang', 15: 'Free Wheel',
    16: 'X52', 17: 'X52 Ice', 18: 'Mammoth', 19: 'Dynamo', 20: 'Nuke Phantom' };

  function msg(id, payloadLen, fill) {
    const buf = new ArrayBuffer(2 + payloadLen);
    const dv = new DataView(buf);
    dv.setUint8(0, 1 + payloadLen); dv.setUint8(1, id);
    if (fill) fill(dv);
    return new Uint8Array(buf);
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const enc = {
    sdkMode: (on = true, flags = 0x01) => msg(MSG.SDK_MODE, 2, d => { d.setUint8(2, on ? 1 : 0); d.setUint8(3, flags); }),
    setSpeed: (speed, accel = 1000, respectLimit = 0) => msg(MSG.SET_SPEED, 5, d => {
      d.setInt16(2, speed, true); d.setInt16(4, accel, true); d.setUint8(6, respectLimit); }),
    setOffset: (mm) => msg(MSG.SET_OFFSET, 4, d => d.setFloat32(2, mm, true)),
    changeLane: (offsetMm, hSpeed = 300, hAccel = 300, hop = 0, tag = 0) => msg(MSG.CHANGE_LANE, 10, d => {
      d.setUint16(2, hSpeed, true); d.setUint16(4, hAccel, true); d.setFloat32(6, offsetMm, true);
      d.setUint8(10, hop); d.setUint8(11, tag); }),
    cancelLane: () => msg(MSG.CANCEL_LANE, 0),
    // mask: low nibble = which lights are being set, high nibble = their on/off values
    setLights: (mask) => msg(MSG.SET_LIGHTS, 1, d => d.setUint8(2, mask)),
    lightMask: (light, on) => (1 << light) | (on ? (1 << (4 + light)) : 0),
    // configs: [{channel,effect,start,end,cyclesPerMin}] up to 3; fixed 17-byte body like the SDK
    lightsPattern: (configs) => msg(MSG.LIGHTS_PATTERN, 16, d => {
      const c = configs.slice(0, 3); d.setUint8(2, c.length);
      c.forEach((x, i) => { const o = 3 + i * 5;
        d.setUint8(o, x.channel); d.setUint8(o + 1, x.effect);
        d.setUint8(o + 2, clamp(x.start, 0, 14)); d.setUint8(o + 3, clamp(x.end, 0, 14));
        d.setUint8(o + 4, Math.round((x.cyclesPerMin || 0) / 6)); }); }),
    battery: () => msg(MSG.BATTERY, 0),
    version: () => msg(MSG.VERSION, 0),
    ping: () => msg(MSG.PING, 0),
    disconnect: () => msg(MSG.DISCONNECT, 0),
    turn: (type = 3, trigger = 0) => msg(MSG.TURN, 2, d => { d.setUint8(2, type); d.setUint8(3, trigger); }),
    setConfig: (material, superCodeMask = 1) => msg(MSG.SET_CONFIG, 2, d => { d.setUint8(2, superCodeMask); d.setUint8(3, material); }),
  };

  function decode(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const id = u8[1], n = u8.length;
    const out = { id, size: u8[0], raw: Array.from(u8) };
    try {
      switch (id) {
        case MSG.POSITION: Object.assign(out, { type: 'position', locationId: u8[2], pieceId: u8[3],
          offset: dv.getFloat32(4, true), speed: dv.getUint16(8, true), flags: u8[10],
          reverseParsing: !!(u8[10] & 0x40) }); break;
        case MSG.TRANSITION: Object.assign(out, { type: 'transition', pieceIdx: dv.getInt8(2),
          prevPieceIdx: dv.getInt8(3), offset: dv.getFloat32(4, true),
          leftWheelCm: n > 16 ? u8[16] : null, rightWheelCm: n > 17 ? u8[17] : null }); break;
        case MSG.BATTERY_RESP: Object.assign(out, { type: 'battery', mv: dv.getUint16(2, true) }); break;
        case MSG.VERSION_RESP: Object.assign(out, { type: 'version', version: dv.getUint16(2, true) }); break;
        case MSG.DELOCALIZED: out.type = 'delocalized'; break;
        case MSG.OFFSET_UPDATE: Object.assign(out, { type: 'offset', offset: dv.getFloat32(2, true) }); break;
        case MSG.STATUS: Object.assign(out, { type: 'status', onTrack: !!u8[2], onCharger: !!u8[3],
          batteryLow: !!u8[4], batteryFull: !!u8[5] }); break;
        case MSG.SPEED_UPDATE: Object.assign(out, { type: 'speed', desired: dv.getUint16(2, true),
          actual: n >= 8 ? dv.getUint16(6, true) : null }); break;
        case MSG.PING_RESP: out.type = 'ping'; break;
        case MSG.COLLISION: out.type = 'collision'; break;
        case MSG.INTERSECTION: out.type = 'intersection'; break;
        default: out.type = 'unknown';
      }
    } catch (e) { out.type = 'malformed'; }
    return out;
  }
  // Battery: rough Li-Po 3.3V..4.2V mapping (estimate only).
  const batteryPct = mv => clamp(Math.round((mv - 3300) / 9), 0, 100);
  const api = { SERVICE, READ_CHR, WRITE_CHR, MSG, LIGHT, CHANNEL, EFFECT, MATERIAL, MODELS, enc, decode, batteryPct };
  if (typeof module !== 'undefined') module.exports = api; else root.TRP = api;
})(this);
