/* =====================================================================
   NESTRA — Utilitários de WebGL e matemática 3D
   Escrito à mão, sem bibliotecas: o site precisa funcionar offline
   (é um PWA) e não pode depender de CDN.
   ===================================================================== */

export const M4 = {
  identity() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  },

  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },

  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  },

  translate(x, y, z) {
    const m = M4.identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  },

  scale(x, y, z) {
    const m = M4.identity();
    m[0] = x; m[5] = y; m[10] = z;
    return m;
  },

  rotateX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    const m = M4.identity();
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
    return m;
  },

  rotateY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    const m = M4.identity();
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
    return m;
  },

  rotateZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    const m = M4.identity();
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
    return m;
  },

  lookAt(eye, center, up) {
    const [ex, ey, ez] = eye;
    let zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez),
      -(yx * ex + yy * ey + yz * ez),
      -(zx * ex + zy * ey + zz * ez),
      1,
    ]);
  },
};

/** Compila um shader e devolve mensagens de erro legíveis. */
export function compile(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader: ' + log);
  }
  return sh;
}

/** Cria um programa e já resolve uniforms e atributos por nome. */
export function program(gl, vsSource, fsSource) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('program: ' + log);
  }

  const u = {};
  const nU = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nU; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }

  const a = {};
  const nA = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < nA; i++) {
    const info = gl.getActiveAttrib(p, i);
    a[info.name] = gl.getAttribLocation(p, info.name);
  }

  return { p, u, a };
}

/** Quad em tela cheia — base de todo passe em fragment shader. */
export function fullscreenQuad(gl) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  return buf;
}

/** Converte float32 para half-float (usado nas texturas R16F do SDF). */
const _f32 = new Float32Array(1);
const _i32 = new Int32Array(_f32.buffer);
export function toHalf(value) {
  _f32[0] = value;
  const x = _i32[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) return bits | 0x7c00;
  if (e < 113) {
    m |= 0x0800;
    return bits + ((m >> (114 - e)) + ((m >> (113 - e)) & 1));
  }
  bits |= ((e - 112) << 10) | (m >> 1);
  return bits + (m & 1);
}

/**
 * Transformada de distância euclidiana exata (Felzenszwalb & Huttenlocher).
 * Trabalha em uma dimensão sobre distâncias já ao quadrado.
 */
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

/** Distância euclidiana ao quadrado, em 2D, para uma máscara binária. */
function edt2d(mask, w, h) {
  const INF = 1e12;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const out = new Float64Array(w * h);

  for (let i = 0; i < w * h; i++) out[i] = mask[i] ? 0 : INF;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  return out;
}

/**
 * Converte a imagem da logo em um campo de distância com sinal.
 * É esta função que permite extrudar QUALQUER logo em 3D sem redesenhá-la:
 * a silhueta sai exatamente dos pixels do arquivo original.
 *
 * @returns {{data: Float32Array, w: number, h: number, aspect: number, pad: number}}
 *          distância em unidades onde 1.0 = metade da altura da imagem.
 */
export function buildSDF(imageData, w, h, pad) {
  pad = pad || 0;
  const pw = w + pad * 2;
  const ph = h + pad * 2;

  const inside = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = imageData[(y * w + x) * 4 + 3];
      inside[(y + pad) * pw + (x + pad)] = a > 127 ? 1 : 0;
    }
  }
  const outsideMask = new Uint8Array(pw * ph);
  for (let i = 0; i < pw * ph; i++) outsideMask[i] = inside[i] ? 0 : 1;

  const dIn = edt2d(inside, pw, ph);        // distância até o traço
  const dOut = edt2d(outsideMask, pw, ph);  // distância até o fundo

  const scale = 2 / ph;   // normaliza para meia-altura = 1
  const sdf = new Float32Array(pw * ph);
  for (let i = 0; i < pw * ph; i++) {
    const outer = Math.sqrt(dIn[i]);
    const inner = Math.sqrt(dOut[i]);
    sdf[i] = (inside[i] ? -inner : outer) * scale;
  }

  return { data: sdf, w: pw, h: ph, aspect: pw / ph, pad };
}

/** Redimensiona uma imagem para caber num limite, preservando a proporção. */
export function rasterize(image, maxSide) {
  let w = image.naturalWidth || image.width;
  let h = image.naturalHeight || image.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, canvas: cv };
}

/**
 * Remove o fundo externo de uma logo exportada sem transparência.
 *
 * Faz um preenchimento por inundação a partir das bordas: só o que está
 * conectado à moldura vira transparente. Brancos internos — a palavra na
 * marca, estrelas, brilhos — continuam intactos, porque não encostam na
 * borda. A logo em si não é alterada; apenas o papel em volta some.
 *
 * Não faz nada se a imagem já tiver transparência.
 */
export function dematte(px, w, h, tolerance = 46) {
  // Já tem canal alfa útil? então não há papel para remover.
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 250) return false;
  }

  const bg = [px[0], px[1], px[2]];
  const dist = (i) => Math.max(
    Math.abs(px[i] - bg[0]),
    Math.abs(px[i + 1] - bg[1]),
    Math.abs(px[i + 2] - bg[2]),
  );

  const outside = new Uint8Array(w * h);
  const stack = [];

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (outside[p]) return;
    if (dist(p * 4) > tolerance) return;
    outside[p] = 1;
    stack.push(p);
  };

  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p - x) / w;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // Borda suave: pixels vizinhos do fundo ganham alfa proporcional à
  // distância da cor de fundo, o que preserva a antisserrilha original.
  const feather = tolerance * 2.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (outside[p]) { px[p * 4 + 3] = 0; continue; }

      const touches =
        (x > 0 && outside[p - 1]) ||
        (x < w - 1 && outside[p + 1]) ||
        (y > 0 && outside[p - w]) ||
        (y < h - 1 && outside[p + w]);

      if (touches) {
        px[p * 4 + 3] = Math.max(0, Math.min(255, Math.round(dist(p * 4) * 255 / feather)));
      }
    }
  }
  return true;
}

/** Reduz uma imagem RGBA por média de blocos, preservando o alfa. */
export function downscaleRGBA(px, w, h, tw, th) {
  const out = new Uint8ClampedArray(tw * th * 4);
  const sx = w / tw;
  const sy = h / th;

  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
          n++;
        }
      }
      const o = (y * tw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

/** Recorta a imagem na caixa mínima que contém pixels visíveis. */
export function trimAlpha(px, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
