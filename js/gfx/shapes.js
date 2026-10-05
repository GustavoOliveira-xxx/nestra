export const SHAPE_BY_ICON = {
  layers: 0,
  briefcase: 1,
  book: 2,
  heart: 3,
  home: 4,
  wallet: 5,
  star: 6,
  bulb: 7,
  target: 8,
  bolt: 9,
  shield: 10,
  grid: 11,
};

export const SHAPE_COUNT = 12;

export function shapeOf(icon) {
  return SHAPE_BY_ICON[icon] ?? 0;
}

export const SDF_LIB =  `mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float dot2(vec2 v) { return dot(v, v); }

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

vec2 opU(vec2 a, vec2 b) { return a.x < b.x ? a : b; }

float opExtrude(float d2, float pz, float h) {
  vec2 w = vec2(d2, abs(pz) - h);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}

float sdSphere(vec3 p, float r) { return length(p) - r; }

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float sdCapsule(vec3 p, float h, float r) {
  p.y -= clamp(p.y, -h, h);
  return length(p) - r;
}

float sdCylinder(vec3 p, float h, float r) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sd2Tri(vec2 p, vec2 q) {
  p.x = abs(p.x);
  vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  float s = -sign(q.y);
  vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)),
               vec2(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}

float sd2Star5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(0.587785252292, 0.809016994375) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

float sd2Heart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) {
    return sqrt(dot2(p - vec2(0.25, 0.75))) - 0.35355339;
  }
  return sqrt(min(dot2(p - vec2(0.0, 1.0)),
                  dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}

float sd2Bolt(vec2 p) {
  vec2 v[7];
  v[0] = vec2( 0.083,  0.833);
  v[1] = vec2(-0.750, -0.167);
  v[2] = vec2(-0.167, -0.167);
  v[3] = vec2(-0.250, -0.833);
  v[4] = vec2( 0.750,  0.167);
  v[5] = vec2( 0.167,  0.167);
  v[6] = vec2( 0.250,  0.833);

  float d = dot2(p - v[0]);
  float s = 1.0;
  for (int i = 0, j = 6; i < 7; j = i, i++) {
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

float sd2Shield(vec2 p) {
  float a = length(p - vec2(-0.55, 0.35)) - 0.95;
  float b = length(p - vec2( 0.55, 0.35)) - 0.95;
  return max(max(a, b), p.y - 0.45);
}
`;

export const SHAPE_GLSL =  `vec2 envShape(vec3 p, int shape, float t, float energy) {
  vec2 res = vec2(10.0, 0.0);

  if (shape == 0) {
    float sep = 0.170 + sin(t * 0.85) * 0.048;
    for (int i = 0; i < 3; i++) {
      float fi = float(i) - 1.0;
      vec3 q = p;
      q.y -= fi * sep;
      q.xz *= rot2(fi * 0.22 + sin(t * 0.6 + fi * 1.4) * 0.15);
      float w = 0.46 - abs(fi) * 0.060;
      bool core = i == 1;
      res = opU(res, vec2(
        sdRoundBox(q, vec3(w, core ? 0.022 : 0.034, w * 0.80), 0.050),
        core ? 2.0 : 0.0));
    }
  }

  else if (shape == 1) {
    res = opU(res, vec2(sdRoundBox(p, vec3(0.43, 0.28, 0.150), 0.055), 0.0));
    res = opU(res, vec2(sdRoundBox(p - vec3(0.0, 0.05, 0.0),
                                   vec3(0.445, 0.026, 0.165), 0.030), 1.0));
    res = opU(res, vec2(sdRoundBox(vec3(p.x, p.y - 0.05, abs(p.z) - 0.200),
                                   vec3(0.058, 0.032, 0.012), 0.012), 2.0));

    vec3 h = p - vec3(0.0, 0.315, 0.0);
    h.yz *= rot2(sin(t * 1.1) * 0.17);
    float handle = max(sdTorus(h.xzy, vec2(0.145, 0.032)), -h.y - 0.02);
    res = opU(res, vec2(handle, 1.0));
  }

  else if (shape == 2) {
    float a = 0.36 + sin(t * 0.6) * 0.22;
    for (int s = 0; s < 2; s++) {
      vec3 q = p;
      q.x *= s == 0 ? 1.0 : -1.0;
      q.xy *= rot2(-a);
      q.x -= 0.33;
      res = opU(res, vec2(
        sdRoundBox(q - vec3(0.0, -0.024, 0.0), vec3(0.31, 0.022, 0.255), 0.022), 0.0));
      res = opU(res, vec2(
        sdRoundBox(q - vec3(-0.014, 0.020, 0.0), vec3(0.285, 0.019, 0.230), 0.015), 1.0));
    }
    res = opU(res, vec2(sdRoundBox(p, vec3(0.030, 0.055, 0.255), 0.030), 0.0));
    res = opU(res, vec2(sdRoundBox(p - vec3(0.0, 0.030, 0.0),
                                   vec3(0.018, 0.014, 0.300), 0.012), 2.0));
  }

  else if (shape == 3) {
    float beat = 1.0
      + pow(max(0.0, sin(t * 1.9)), 8.0) * 0.10
      + pow(max(0.0, sin(t * 1.9 - 0.62)), 10.0) * 0.06;
    vec3 q = p / beat;
    vec2 h = q.xy * 1.16;
    h.y += 0.56;
    float d = opExtrude(sd2Heart(h) / 1.16, q.z, 0.115) - 0.055;
    res = opU(res, vec2(d * beat, 0.0));
  }

  else if (shape == 4) {
    float lift = sin(t * 0.8) * 0.028;
    res = opU(res, vec2(
      sdRoundBox(p - vec3(0.0, -0.21, 0.0), vec3(0.34, 0.20, 0.29), 0.040), 0.0));

    float roof = opExtrude(sd2Tri(vec2(p.x, 0.42 + lift - p.y), vec2(0.47, 0.42)),
                           p.z, 0.30) - 0.035;
    res = opU(res, vec2(roof, 1.0));

    res = opU(res, vec2(
      sdRoundBox(p - vec3(-0.265, 0.22 + lift, 0.0), vec3(0.044, 0.135, 0.044), 0.020), 1.0));

    res = opU(res, vec2(
      sdRoundBox(vec3(p.x, p.y + 0.21, abs(p.z) - 0.325),
                 vec3(0.090, 0.090, 0.012), 0.015), 2.0));
  }

  else if (shape == 5) {
    float slide = 0.10 + sin(t * 0.75) * 0.075;
    vec3 c = p - vec3(0.0, 0.22 + slide, 0.0);
    c.xy *= rot2(0.06);
    res = opU(res, vec2(sdRoundBox(c, vec3(0.295, 0.180, 0.012), 0.025), 1.0));
    res = opU(res, vec2(
      sdRoundBox(c - vec3(0.0, 0.066, 0.0), vec3(0.300, 0.026, 0.032), 0.010), 2.0));

    res = opU(res, vec2(sdRoundBox(p, vec3(0.41, 0.27, 0.090), 0.055), 0.0));
    res = opU(res, vec2(
      sdRoundBox(p - vec3(0.0, -0.04, 0.0), vec3(0.425, 0.032, 0.104), 0.030), 1.0));
  }

  else if (shape == 6) {
    vec3 q = p;
    q.xy *= rot2(t * 0.32);
    float d2 = sd2Star5(q.xy * 1.18, 0.62, 0.42) / 1.18;
    res = opU(res, vec2(opExtrude(d2, q.z, 0.080) - 0.055, 0.0));
    res = opU(res, vec2(sdSphere(p, 0.165 + sin(t * 2.6) * 0.012), 2.0));
  }

  else if (shape == 7) {
    float glass = sdSphere(p - vec3(0.0, 0.14, 0.0), 0.310);
    float neck = sdCapsule(p - vec3(0.0, -0.20, 0.0), 0.055, 0.145);
    res = opU(res, vec2(smin(glass, neck, 0.13), 2.0));

    res = opU(res, vec2(sdCylinder(p - vec3(0.0, -0.385, 0.0), 0.080, 0.132), 1.0));
    for (int i = 0; i < 3; i++) {
      res = opU(res, vec2(
        sdTorus(p - vec3(0.0, -0.305 - float(i) * 0.058, 0.0), vec2(0.134, 0.022)), 1.0));
    }
    res = opU(res, vec2(sdSphere(p - vec3(0.0, -0.470, 0.0), 0.052), 1.0));
  }

  else if (shape == 8) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec3 q = p;
      float ph = t * (0.45 + fi * 0.20) + fi * 2.1;
      q.yz *= rot2(sin(ph) * 0.38);
      q.xz *= rot2(cos(ph * 0.75) * 0.32);
      res = opU(res, vec2(
        sdTorus(q.xzy, vec2(0.56 - fi * 0.150, 0.042 - fi * 0.006)),
        i == 1 ? 1.0 : 0.0));
    }
    res = opU(res, vec2(sdSphere(p, 0.135 + sin(t * 2.2) * 0.014), 2.0));
  }

  else if (shape == 9) {
    float kick = 1.0 + pow(max(0.0, sin(t * 3.1)), 12.0) * 0.075;
    vec3 q = p / kick;
    res = opU(res, vec2(
      (opExtrude(sd2Bolt(q.xy / 0.70) * 0.70, q.z, 0.072) - 0.048) * kick, 0.0));
    res = opU(res, vec2(
      (opExtrude(sd2Bolt(q.xy / 0.45) * 0.45, q.z, 0.100) - 0.034) * kick, 2.0));
  }

  else if (shape == 10) {
    res = opU(res, vec2(
      opExtrude(sd2Shield(p.xy / 1.35) * 1.35, p.z, 0.10) - 0.050, 0.0));
    vec3 c = vec3(p.x, p.y - 0.045, abs(p.z) - 0.135);
    res = opU(res, vec2(min(sdRoundBox(c, vec3(0.040, 0.190, 0.022), 0.018),
                            sdRoundBox(c, vec3(0.150, 0.040, 0.022), 0.018)), 2.0));
  }

  else {
    float gap = 0.045 + sin(t * 0.9) * 0.030;
    vec3 q = abs(p) - vec3(0.230 + gap, 0.230 + gap, 0.190 + gap * 0.6);
    q.xy *= rot2(sin(t * 0.7) * 0.14);
    res = opU(res, vec2(sdRoundBox(q, vec3(0.170, 0.170, 0.130), 0.045), 0.0));
    res = opU(res, vec2(sdSphere(p, 0.118 + sin(t * 1.8) * 0.014), 2.0));
  }

  return res;
}

float envGlow(int shape, float t, float energy) {
  float g;
  if (shape == 7) {
    g = 0.86 + 0.16 * sin(t * 7.0) * sin(t * 2.3) + 0.06 * sin(t * 23.0);
  } else if (shape == 9) {
    g = 0.50 + pow(max(0.0, sin(t * 3.1)), 10.0) * 0.90 + 0.10 * sin(t * 31.0);
  } else if (shape == 3) {
    g = 0.55 + pow(max(0.0, sin(t * 1.9)), 8.0) * 0.75;
  } else if (shape == 8) {
    g = 0.62 + 0.38 * (sin(t * 2.2) * 0.5 + 0.5);
  } else if (shape == 6) {
    g = 0.58 + 0.42 * pow(max(0.0, sin(t * 1.4)), 3.0);
  } else {
    g = 0.72 + 0.28 * (sin(t * 1.6) * 0.5 + 0.5);
  }
  return g * (0.78 + energy * 0.45);
}
`;

export const SHAPES_GLSL = SDF_LIB + SHAPE_GLSL;
