// Mesh file formats: STL (binary + ASCII), OBJ and 3MF. Pure functions that
// work in the browser and in Node.

// ---- STL ---------------------------------------------------------------

export function isBinarySTL(buffer) {
  if (buffer.byteLength < 84) return false;
  const count = new DataView(buffer).getUint32(80, true);
  if (84 + count * 50 === buffer.byteLength) return true;
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512)));
  // ASCII files start with "solid" and contain "facet"; some binary files
  // also start with "solid", so check for the keyword too.
  return !(head.trimStart().startsWith('solid') && /facet/.test(head));
}

export function parseSTL(buffer) {
  if (buffer instanceof Uint8Array) buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (isBinarySTL(buffer)) {
    const dv = new DataView(buffer);
    const n = dv.getUint32(80, true);
    const max = Math.floor((buffer.byteLength - 84) / 50);
    const count = Math.min(n, max);
    const positions = new Float32Array(count * 9);
    let o = 84;
    for (let i = 0; i < count; i++) {
      o += 12;
      for (let k = 0; k < 9; k++) {
        positions[i * 9 + k] = dv.getFloat32(o, true);
        o += 4;
      }
      o += 2;
    }
    return { positions, indices: sequential(count * 3) };
  }
  const text = new TextDecoder().decode(buffer);
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  const usable = out.length - (out.length % 9);
  return { positions: new Float32Array(out.slice(0, usable)), indices: sequential(usable / 3) };
}

function sequential(n) {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

function triNormal(p, a, b, c) {
  const ux = p[b] - p[a];
  const uy = p[b + 1] - p[a + 1];
  const uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a];
  const vy = p[c + 1] - p[a + 1];
  const vz = p[c + 2] - p[a + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// parts: [{ positions, indices, name? }]
export function writeSTL(parts, { binary = true, name = 'ShaperBuild' } = {}) {
  const total = parts.reduce((s, p) => s + p.indices.length / 3, 0);
  if (binary) {
    const buf = new ArrayBuffer(84 + total * 50);
    const bytes = new Uint8Array(buf);
    const header = new TextEncoder().encode(`Exported from ${name}`.slice(0, 79));
    bytes.set(header, 0);
    const dv = new DataView(buf);
    dv.setUint32(80, total, true);
    let o = 84;
    for (const { positions: p, indices: idx } of parts) {
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3;
        const b = idx[i + 1] * 3;
        const c = idx[i + 2] * 3;
        const n = triNormal(p, a, b, c);
        dv.setFloat32(o, n[0], true);
        dv.setFloat32(o + 4, n[1], true);
        dv.setFloat32(o + 8, n[2], true);
        o += 12;
        for (const v of [a, b, c]) {
          dv.setFloat32(o, p[v], true);
          dv.setFloat32(o + 4, p[v + 1], true);
          dv.setFloat32(o + 8, p[v + 2], true);
          o += 12;
        }
        o += 2;
      }
    }
    return bytes;
  }
  const lines = [`solid ${name}`];
  const f = (x) => (Number.isFinite(x) ? +x.toPrecision(9) : 0);
  for (const { positions: p, indices: idx } of parts) {
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3;
      const b = idx[i + 1] * 3;
      const c = idx[i + 2] * 3;
      const n = triNormal(p, a, b, c);
      lines.push(`facet normal ${f(n[0])} ${f(n[1])} ${f(n[2])}`, ' outer loop');
      for (const v of [a, b, c]) lines.push(`  vertex ${f(p[v])} ${f(p[v + 1])} ${f(p[v + 2])}`);
      lines.push(' endloop', 'endfacet');
    }
  }
  lines.push(`endsolid ${name}`);
  return new TextEncoder().encode(lines.join('\n') + '\n');
}

// ---- OBJ ---------------------------------------------------------------

export function parseOBJ(buffer) {
  const text = typeof buffer === 'string' ? buffer : new TextDecoder().decode(buffer);
  const verts = [];
  const tris = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/);
      verts.push(+x, +y, +z);
    } else if (line.startsWith('f ')) {
      const ids = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((t) => {
          const i = parseInt(t.split('/')[0], 10);
          return i < 0 ? verts.length / 3 + i : i - 1;
        });
      for (let i = 1; i + 1 < ids.length; i++) tris.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  return { positions: new Float32Array(verts), indices: new Uint32Array(tris) };
}

// mtl: name of a material file (see core/exporters.js) giving each body
// its colour.
export function writeOBJ(parts, { name = 'ShaperBuild', mtl = null } = {}) {
  const lines = [`# Exported from ${name}`];
  if (mtl) lines.push(`mtllib ${mtl}`);
  let base = 1;
  parts.forEach((part, pi) => {
    const id = (part.name || `body_${pi + 1}`).replace(/\s+/g, '_');
    lines.push(`o ${id}`);
    if (mtl) lines.push(`usemtl ${id}_mat`);
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) lines.push(`v ${+p[i].toPrecision(9)} ${+p[i + 1].toPrecision(9)} ${+p[i + 2].toPrecision(9)}`);
    const idx = part.indices;
    for (let i = 0; i < idx.length; i += 3) lines.push(`f ${idx[i] + base} ${idx[i + 1] + base} ${idx[i + 2] + base}`);
    base += p.length / 3;
  });
  return new TextEncoder().encode(lines.join('\n') + '\n');
}

// ---- 3MF (zip + XML) -----------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Minimal zip writer (stored, no compression).
export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Read a zip archive; deflated entries use DecompressionStream.
export async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid 3MF/zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(local + 26, true);
    const lxlen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lxlen;
    const data = bytes.subarray(start, start + csize);
    files[name] = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

async function inflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function write3MF(parts, { unit = 'millimeter' } = {}) {
  const enc = new TextEncoder();
  const objects = parts
    .map((part, i) => {
      const p = part.positions;
      const idx = part.indices;
      const v = [];
      for (let k = 0; k < p.length; k += 3) v.push(`<vertex x="${+p[k].toPrecision(9)}" y="${+p[k + 1].toPrecision(9)}" z="${+p[k + 2].toPrecision(9)}"/>`);
      const t = [];
      for (let k = 0; k < idx.length; k += 3) t.push(`<triangle v1="${idx[k]}" v2="${idx[k + 1]}" v3="${idx[k + 2]}"/>`);
      const name = String(part.name || `Body ${i + 1}`).replace(/[<&"]/g, '');
      return `<object id="${i + 1}" name="${name}" type="model"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`;
    })
    .join('');
  const items = parts.map((_, i) => `<item objectid="${i + 1}"/>`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">ShaperBuild</metadata><resources>${objects}</resources><build>${items}</build></model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}

const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

// Returns one mesh per <object> (build transforms are applied).
export async function parse3MF(bytes) {
  const files = await unzip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const modelName = Object.keys(files).find((n) => /3dmodel\.model$/i.test(n)) || Object.keys(files).find((n) => n.endsWith('.model'));
  if (!modelName || !files[modelName]) throw new Error('No 3D model found in the 3MF file');
  const xml = new TextDecoder().decode(files[modelName]);
  const unit = (xml.match(/<model[^>]*\sunit="([^"]+)"/) || [])[1] || 'millimeter';
  const s = UNIT_MM[unit] || 1;
  const objects = {};
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = objRe.exec(xml))) {
    const id = (m[1].match(/\bid="([^"]+)"/) || [])[1];
    const name = (m[1].match(/\bname="([^"]*)"/) || [])[1];
    const body = m[2];
    const verts = [];
    const vr = /<vertex\b[^>]*?x="([^"]+)"[^>]*?y="([^"]+)"[^>]*?z="([^"]+)"/g;
    let v;
    while ((v = vr.exec(body))) verts.push(+v[1] * s, +v[2] * s, +v[3] * s);
    const tris = [];
    const tr = /<triangle\b[^>]*?v1="(\d+)"[^>]*?v2="(\d+)"[^>]*?v3="(\d+)"/g;
    let t;
    while ((t = tr.exec(body))) tris.push(+t[1], +t[2], +t[3]);
    if (verts.length && tris.length) objects[id] = { name, positions: new Float32Array(verts), indices: new Uint32Array(tris) };
  }
  const out = [];
  const itemRe = /<item\b([^>]*)\/?>/g;
  let it;
  while ((it = itemRe.exec(xml))) {
    const id = (it[1].match(/objectid="([^"]+)"/) || [])[1];
    const tf = (it[1].match(/transform="([^"]+)"/) || [])[1];
    const obj = objects[id];
    if (!obj) continue;
    let positions = obj.positions;
    if (tf) {
      const a = tf.trim().split(/\s+/).map(Number);
      positions = new Float32Array(obj.positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        const x = obj.positions[i];
        const y = obj.positions[i + 1];
        const z = obj.positions[i + 2];
        positions[i] = x * a[0] + y * a[3] + z * a[6] + a[9] * s;
        positions[i + 1] = x * a[1] + y * a[4] + z * a[7] + a[10] * s;
        positions[i + 2] = x * a[2] + y * a[5] + z * a[8] + a[11] * s;
      }
    }
    out.push({ name: obj.name, positions, indices: obj.indices });
  }
  if (!out.length) out.push(...Object.values(objects));
  return out;
}
