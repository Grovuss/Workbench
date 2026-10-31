// Minimal reader/writer for uncompressed NBT, Minecraft's binary data format (servers.dat).
// Values keep their tag type so files round-trip unchanged:
//   { type: 'compound', value: { name: { type: 'string', value: '…' } } }
//   { type: 'list', listType: 'compound', value: [ … plain values … ] }

const TYPES = ['end', 'byte', 'short', 'int', 'long', 'float', 'double', 'byteArray', 'string', 'list', 'compound', 'intArray', 'longArray'];
const ID = Object.fromEntries(TYPES.map((t, i) => [t, i]));

function read(buf) {
  let pos = 0;
  const need = (n) => {
    if (pos + n > buf.length) throw new Error('Corrupt NBT data.');
  };
  const u8 = () => (need(1), buf.readUInt8(pos++));
  const i16 = () => (need(2), (pos += 2), buf.readInt16BE(pos - 2));
  const i32 = () => (need(4), (pos += 4), buf.readInt32BE(pos - 4));
  const str = () => {
    need(2);
    const len = buf.readUInt16BE(pos);
    pos += 2;
    need(len);
    pos += len;
    return buf.toString('utf8', pos - len, pos);
  };

  function payload(type) {
    switch (type) {
      case 'byte': return (need(1), buf.readInt8(pos++));
      case 'short': return i16();
      case 'int': return i32();
      case 'long': return (need(8), (pos += 8), buf.readBigInt64BE(pos - 8));
      case 'float': return (need(4), (pos += 4), buf.readFloatBE(pos - 4));
      case 'double': return (need(8), (pos += 8), buf.readDoubleBE(pos - 8));
      case 'byteArray': {
        const len = i32();
        need(len);
        pos += len;
        return Buffer.from(buf.subarray(pos - len, pos));
      }
      case 'string': return str();
      case 'list': {
        const listType = TYPES[u8()];
        const len = i32();
        const value = [];
        for (let i = 0; i < len; i++) value.push(payload(listType));
        return { listType, value };
      }
      case 'compound': {
        const value = {};
        for (;;) {
          const t = TYPES[u8()];
          if (t === 'end') return value;
          if (!t) throw new Error('Corrupt NBT data.');
          const name = str();
          value[name] = tagged(t);
        }
      }
      case 'intArray': {
        const len = i32();
        return Array.from({ length: len }, i32);
      }
      case 'longArray': {
        const len = i32();
        return Array.from({ length: len }, () => (need(8), (pos += 8), buf.readBigInt64BE(pos - 8)));
      }
      default:
        throw new Error('Corrupt NBT data.');
    }
  }

  // Lists store their element type once, so their items are plain payloads; everything else is tagged.
  function tagged(type) {
    const value = payload(type);
    return type === 'list' ? { type, listType: value.listType, value: value.value } : { type, value };
  }

  const rootType = TYPES[u8()];
  if (rootType !== 'compound') throw new Error('Corrupt NBT data.');
  str(); // root name, usually ""
  return { type: 'compound', value: payload('compound') };
}

function write(root) {
  const chunks = [];
  const u8 = (n) => chunks.push(Buffer.from([n]));
  const sized = (n, fn) => {
    const b = Buffer.alloc(n);
    fn(b);
    chunks.push(b);
  };
  const i32 = (n) => sized(4, (b) => b.writeInt32BE(n));
  const str = (s) => {
    const bytes = Buffer.from(s, 'utf8');
    sized(2, (b) => b.writeUInt16BE(bytes.length));
    chunks.push(bytes);
  };

  function payload(type, value, listType) {
    switch (type) {
      case 'byte': return sized(1, (b) => b.writeInt8(value));
      case 'short': return sized(2, (b) => b.writeInt16BE(value));
      case 'int': return i32(value);
      case 'long': return sized(8, (b) => b.writeBigInt64BE(BigInt(value)));
      case 'float': return sized(4, (b) => b.writeFloatBE(value));
      case 'double': return sized(8, (b) => b.writeDoubleBE(value));
      case 'byteArray': return (i32(value.length), chunks.push(Buffer.from(value)));
      case 'string': return str(value);
      case 'list':
        u8(value.length ? ID[listType] : ID.end);
        i32(value.length);
        for (const item of value) payload(listType, listType === 'list' ? item.value : item, listType === 'list' ? item.listType : undefined);
        return;
      case 'compound':
        for (const [name, tag] of Object.entries(value)) {
          u8(ID[tag.type]);
          str(name);
          payload(tag.type, tag.value, tag.listType);
        }
        return u8(ID.end);
      case 'intArray': return (i32(value.length), value.forEach(i32));
      case 'longArray': return (i32(value.length), value.forEach((v) => sized(8, (b) => b.writeBigInt64BE(BigInt(v)))));
    }
  }

  u8(ID.compound);
  str('');
  payload('compound', root.value);
  return Buffer.concat(chunks);
}

module.exports = { read, write };
