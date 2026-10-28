// Minimal CBOR decoder (RFC 8949) for Auctionator's retail price database.
// WoW's C_EncodingUtil.SerializeCBOR writes each realm's prices as one CBOR
// value. Byte strings and text strings both come back as JS strings
// (bytes mapped 1:1 to char codes), which is what Lua uses as table keys.

export type CborValue = number | string | boolean | null | undefined | CborValue[] | { [key: string]: CborValue };

export function decodeCbor(bytes: Uint8Array): CborValue {
  let i = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  function length(info: number): number {
    if (info < 24) return info;
    if (info === 24) return bytes[i++];
    if (info === 25) {
      const v = view.getUint16(i);
      i += 2;
      return v;
    }
    if (info === 26) {
      const v = view.getUint32(i);
      i += 4;
      return v;
    }
    if (info === 27) {
      const v = Number(view.getBigUint64(i));
      i += 8;
      return v;
    }
    throw new Error(`CBOR: unsupported length encoding ${info} at byte ${i}`);
  }

  function binaryString(len: number): string {
    let s = '';
    for (let k = 0; k < len; k += 8192) {
      s += String.fromCharCode(...bytes.subarray(i + k, i + Math.min(len, k + 8192)));
    }
    i += len;
    return s;
  }

  function item(): CborValue {
    if (i >= bytes.length) throw new Error('CBOR: unexpected end of data');
    const initial = bytes[i++];
    const major = initial >> 5;
    const info = initial & 31;
    switch (major) {
      case 0:
        return length(info);
      case 1:
        return -1 - length(info);
      case 2:
      case 3:
        return binaryString(length(info));
      case 4: {
        const n = length(info);
        const arr: CborValue[] = [];
        for (let k = 0; k < n; k++) arr.push(item());
        return arr;
      }
      case 5: {
        const n = length(info);
        const obj: { [key: string]: CborValue } = {};
        for (let k = 0; k < n; k++) {
          const key = item();
          obj[String(key)] = item();
        }
        return obj;
      }
      case 6:
        length(info); // tag: ignore, read the tagged value
        return item();
      case 7: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        if (info === 25) {
          const half = view.getUint16(i);
          i += 2;
          const exp = (half >> 10) & 31;
          const frac = half & 1023;
          const sign = half & 0x8000 ? -1 : 1;
          if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
          if (exp === 31) return frac ? NaN : sign * Infinity;
          return sign * 2 ** (exp - 15) * (1 + frac / 1024);
        }
        if (info === 26) {
          const v = view.getFloat32(i);
          i += 4;
          return v;
        }
        if (info === 27) {
          const v = view.getFloat64(i);
          i += 8;
          return v;
        }
        throw new Error(`CBOR: unsupported simple value ${info}`);
      }
    }
    throw new Error('CBOR: invalid data');
  }

  return item();
}

/** A Lua string read byte-for-byte (char codes 0-255) to bytes. */
export function binaryStringToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k) & 0xff;
  return out;
}
