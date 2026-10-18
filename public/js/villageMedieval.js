// Village médiéval (Medieval Village Pack) : maisons dans les remparts, quartier extérieur sur les collines,
// moulin, clocher, écurie, scierie, champs clôturés, et un château au nord. Grilles fermées aux deux portes.
import * as THREE from 'three';
import { prop } from './models.js';
import { bake } from './villageDecor.js';

const rnd = (() => { let s = 4242; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();

export function buildMedieval(v, villageHeight) {
  const tmp = new THREE.Group();
  v.root.add(tmp);
  v.houseSpots = [];
  v.noTree = [];   // zones où l'on ne plante pas d'arbres (bâtiments extérieurs)
  const lowest = (x, z, r) => Math.min(...[[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]].map(([a, b]) => villageHeight(x + a, z + b)));
  // pose un modèle ; renvoie son emprise (largeur, profondeur, centre local)
  const put = (name, x, z, ry, s, y = null, parent = tmp) => {
    const o = prop(name, s);
    o.rotation.y = ry;
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    o.position.set(x, y ?? lowest(x, z, Math.max(size.x, size.z) * 0.45) - 0.08, z);
    parent.add(o);
    return { o, w: size.x, d: size.z, cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2 };
  };
  // collision d'un rectangle (approché par des cercles)
  const rectColl = (x, z, w, d, r0 = 0) => {
    const r = Math.min(w, d) / 2 + r0;
    const nx = Math.max(1, Math.round(w / (r * 1.4))), nz = Math.max(1, Math.round(d / (r * 1.4)));
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      v.colliders.push({ x: x - w / 2 + r + (w - 2 * r) * (nx > 1 ? i / (nx - 1) : 0.5), z: z - d / 2 + r + (d - 2 * r) * (nz > 1 ? k / (nz - 1) : 0.5), r: r * 0.95 });
    }
  };

  // ---------------- Maisons dans les remparts ----------------
  const inside = [
    ['v_house_b', -0.43], ['v_house_c', -1.2], ['v_barracks', -1.94], ['v_house_b', -2.7],
    ['v_inn', 0.5], ['v_house_c', 2.65], ['v_barracks', 1.98], ['v_house_b', 1.16],
  ];
  // angle (radians, mesuré depuis +x) ; on évite la forge (ouest), le classement (est) et les chemins
  for (const [name, a] of inside) {
    const R = name === 'v_inn' ? 24.5 : 25.5;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    const ry = Math.atan2(-x, -z);   // façade (+z du modèle) vers la place
    const p = put(name, x, z, ry, name === 'v_inn' ? 2.1 : 2.3, 0);
    rectColl(x + p.cx, z + p.cz, p.w * 0.92, p.d * 0.92);
    // emprise dans le repère de la maison pour le décor (tonneaux, caisses devant)
    const fw = name === 'v_inn' ? 8.4 : 5, fd = name === 'v_inn' ? 8.4 : 6;
    v.houseSpots.push([x, z, fw, fd, ry]);
  }

  // ---------------- Puits, kiosque, feu de camp, étals, charrettes ----------------
  const deco = [
    ['v_well', 7.5, 19.5, 0.3, 2.3, 1.0], ['v_gazebo', -19.5, -12.5, 0.8, 2.4, 1.6], ['v_bonfire', 19.5, 14, 0, 3.2, 0.9],
    ['v_bench', 17.6, 16.5, 2.3, 2.6, 0.5], ['v_bench', 21.6, 12.2, -0.9, 2.6, 0.5], ['v_bench', 21.4, 16.4, 0.7, 2.6, 0.5],
    ['v_stand_a', -7, -19.5, 0.2, 2.4, 1.0], ['v_stand_b', 7, -19.5, -0.2, 2.4, 1.1], ['v_cart', -20.5, 13.5, 2.2, 2.3, 1.0],
    ['v_cart', 22.5, -6.5, -2.4, 2.3, 1.0], ['v_cauldron', -8.8, 20.2, 0, 3, 0.6], ['v_hay', -21.5, 16.8, 0, 4, 0.5], ['v_hay', -22.6, 15.8, 1, 4, 0.5],
    ['v_barrel', -6, 21, 0, 4, 0.45], ['v_barrel', -5.2, 21.6, 0, 4, 0.45], ['v_crate', 9.5, -21, 0.4, 4, 0.45], ['v_crate', 10.2, -21.6, 1.2, 4, 0.45],
    ['v_bags', -9.2, -21, 0.5, 4, 0.5], ['v_package', 5.2, -21.4, 0.3, 4, 0.4], ['v_rocks', 13, 22, 0.7, 4, 0],
  ];
  for (const [name, x, z, ry, s, cr] of deco) {
    put(name, x, z, ry, s, 0);
    if (cr) v.colliders.push({ x, z, r: cr });
  }

  // ---------------- Quartier hors des remparts (sur les collines) ----------------
  const outside = [
    ['v_smithy', -0.9, 52, 2.3], ['v_stable', -0.35, 56, 2.3], ['v_house_b', 0.25, 50, 2.4], ['v_mill', 0.75, 60, 2.5],
    ['v_house_c', 1.15, 49, 2.4], ['v_sawmill', 2.0, 54, 2.3], ['v_inn', 2.45, 50, 2.2], ['v_house_b', 2.85, 48, 2.3],
    ['v_barracks', -2.95, 49, 2.5], ['v_house_c', -2.55, 52, 2.4], ['v_house_b', -2.15, 47, 2.4], ['v_belltower', -1.25, 63, 2.5],
    ['v_house_c', -0.55, 46, 2.3], ['v_house_c', 0.5, 66, 2.4], ['v_barracks', 1.55, 62, 2.5],
    // deuxième rangée, plus loin sur les collines
    ['v_house_b', -2.6, 74, 2.4], ['v_house_c', 2.2, 73, 2.4], ['v_stable', 2.85, 71, 2.3], ['v_mill', -2.15, 78, 2.6],
    ['v_house_b', 0.1, 77, 2.4], ['v_barracks', 1.0, 75, 2.5], ['v_house_c', -0.9, 72, 2.4],
  ];
  for (const [name, a, R, s] of outside) {
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    const ry = Math.atan2(-x, -z) + (rnd() - 0.5) * 0.4;
    const p = put(name, x, z, ry, s);
    v.noTree.push({ x, z, r: Math.max(p.w, p.d) / 2 + 2 });
  }
  // champs clôturés et meules de foin près de l'écurie et de la scierie
  const field = (cx, cz, w, d, ry) => {
    const c = Math.cos(ry), sn = Math.sin(ry);
    const P = (lx, lz) => [cx + lx * c + lz * sn, cz - lx * sn + lz * c];
    const seg = 2.35;
    for (const [lx0, lz0, lx1, lz1] of [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]]) {
      const L = Math.hypot(lx1 - lx0, lz1 - lz0), n = Math.round(L / seg);
      for (let i = 0; i < n; i++) {
        if (i === 1 && lz0 === d / 2) continue;   // une ouverture
        const t = (i + 0.5) / n, [x, z] = P(lx0 + (lx1 - lx0) * t, lz0 + (lz1 - lz0) * t);
        put('v_fence', x, z, ry + Math.atan2(-(lz1 - lz0), lx1 - lx0), 3, villageHeight(x, z) - 0.05);
      }
    }
    for (let i = 0; i < 6; i++) {
      const [x, z] = P((rnd() - 0.5) * w * 0.7, (rnd() - 0.5) * d * 0.7);
      put('v_hay', x, z, rnd() * 3, 4.5, villageHeight(x, z) - 0.05);
    }
    v.noTree.push({ x: cx, z: cz, r: Math.max(w, d) / 2 + 1 });
  };
  field(Math.cos(-0.1) * 48, Math.sin(-0.1) * 48, 12, 8, Math.PI / 2 + 0.1);
  field(Math.cos(2.65) * 56, Math.sin(2.65) * 56, 10, 9, -2.65 + Math.PI / 2);
  // charrettes, tonneaux et caisses éparpillés dehors
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, R = 40 + rnd() * 14, x = Math.cos(a) * R, z = Math.sin(a) * R;
    if (Math.abs(x) < 7 || v.noTree.some((n) => Math.hypot(n.x - x, n.z - z) < n.r - 1)) continue;
    const name = ['v_cart', 'v_barrel', 'v_crate', 'v_bags', 'v_hay'][i % 5];
    put(name, x, z, rnd() * 6, name === 'v_cart' ? 2.3 : 4, villageHeight(x, z) - 0.05);
  }

  // ---------------- Hameaux supplémentaires sur les collines (placement déterministe) ----------------
  // [angle depuis +x, distance au centre] : petits groupes de 2 à 4 maisons + un peu de décor
  const hamlets = [
    [-0.55, 44], [-0.2, 58], [0.35, 44], [0.55, 64], [0.9, 52], [-0.9, 62], [0.1, 82], [-0.5, 84],
    [2.64, 44], [2.9, 66], [3.5, 50], [2.4, 58], [3.3, 78], [-2.3, 70],
    [1.25, 48], [1.9, 50], [-1.3, 48], [-1.85, 52], [1.3, 75], [1.85, 78],
  ];
  const houseNames = ['v_house_b', 'v_house_c', 'v_house_b', 'v_house_c', 'v_inn', 'v_barracks', 'v_stable'];
  const houseScale = { v_inn: 2.2, v_stable: 2.3, v_barracks: 2.5 };
  const decoNames = [['v_cart', 2.3, 1.0], ['v_well', 2.3, 1.0], ['v_stand_a', 2.4, 1.0], ['v_barrel', 4, 0.45], ['v_crate', 4, 0.45], ['v_hay', 4, 0.5], ['v_bags', 4, 0.5], ['v_bench', 2.6, 0.5], ['v_fence', 3, 0]];
  let hr = 777;
  const hrnd = () => { hr = (hr * 16807) % 2147483647; return (hr - 1) / 2147483646; };   // graine propre : ne décale pas le reste
  // libre = hors chemin (|x| < 8), hors château, hors remparts, et sans chevaucher un bâtiment déjà posé
  const free = (x, z, r) => Math.abs(x) > 8 + r * 0.5 && Math.hypot(x, z + 76) > 28 + r && Math.hypot(x, z) > 42 && Math.hypot(x, z) < 92
    && !v.noTree.some((n) => Math.hypot(n.x - x, n.z - z) < n.r + r - 2);
  hamlets.forEach(([a, R], gi) => {
    const gx = Math.cos(a) * R, gz = Math.sin(a) * R;
    const faceBase = gi % 2 ? Math.atan2(-gx, 0) : Math.atan2(-gx, -gz);   // vers le chemin ou vers le centre
    const count = 2 + (gi % 3);
    const placed = [];
    for (let k = 0; k < count; k++) {
      const name = houseNames[Math.floor(hrnd() * houseNames.length)];
      const s = (houseScale[name] ?? 2.4) * (0.9 + hrnd() * 0.2), er = name === 'v_house_b' || name === 'v_house_c' ? 5 : 6.5;
      for (let t = 0; t < 12; t++) {
        const ang = hrnd() * Math.PI * 2, d = k === 0 && t < 3 ? t * 2 : 7 + t * 0.7 + hrnd() * 3;
        const x = gx + Math.cos(ang) * d, z = gz + Math.sin(ang) * d;
        if (!free(x, z, er)) continue;
        const p = put(name, x, z, faceBase + (hrnd() - 0.5) * 0.52, s);   // ±15°
        rectColl(x + p.cx, z + p.cz, p.w * 0.92, p.d * 0.92);
        v.noTree.push({ x, z, r: Math.max(p.w, p.d) / 2 + 2 });
        placed.push([x, z]);
        break;
      }
    }
    if (!placed.length) return;
    // décor entre les maisons du groupe
    const nd = 2 + (gi % 2);
    for (let k = 0; k < nd; k++) {
      const [name, s, cr] = decoNames[Math.floor(hrnd() * decoNames.length)];
      const [px, pz] = placed[k % placed.length];
      for (let t = 0; t < 6; t++) {
        const ang = hrnd() * Math.PI * 2, d = 4.5 + t * 0.8;
        const x = px + Math.cos(ang) * d, z = pz + Math.sin(ang) * d;
        if (!free(x, z, 1.5)) continue;
        put(name, x, z, hrnd() * 6.28, s * (0.9 + hrnd() * 0.2));
        if (cr) v.colliders.push({ x, z, r: cr });
        v.noTree.push({ x, z, r: 1.5 });
        break;
      }
    }
  });

  // ---------------- Château au nord ----------------
  buildCastle(v, tmp, 0, -76, villageHeight, put);
  v.noTree.push({ x: 0, z: -76, r: 24 });

  // ---------------- Grilles des portes (on ne sort pas des remparts) ----------------
  const WALL_R = 34;
  for (const sz of [1, -1]) {
    const z = sz * Math.sqrt(WALL_R * WALL_R - 4.6 * 4.6);
    const g = new THREE.Group();
    g.position.set(0, villageHeight(0, z), z);
    const bars = [];
    for (let x = -3.9; x <= 3.91; x += 0.42) { const b = new THREE.BoxGeometry(0.11, 4.6, 0.11); b.translate(x, 2.3, 0); bars.push(b); }
    for (const y of [0.9, 2.1, 3.3, 4.4]) { const b = new THREE.BoxGeometry(8.0, 0.12, 0.13); b.translate(0, y, 0); bars.push(b); }
    // pointes en bas
    for (let x = -3.9; x <= 3.91; x += 0.42) { const c = new THREE.ConeGeometry(0.08, 0.25, 4); c.rotateX(Math.PI); c.translate(x, -0.1, 0); bars.push(c); }
    const geo = bars.map((b) => b.toNonIndexed());
    const merged = new THREE.Mesh(mergeAll(geo), v.M.iron);
    merged.castShadow = true;
    g.add(merged);
    // linteau de bois au-dessus de la grille
    const beam = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.5, 0.5), v.M.log);
    beam.position.y = 4.85; beam.castShadow = true;
    g.add(beam);
    tmp.add(g);
    for (let x = -4.3; x <= 4.31; x += 0.6) v.colliders.push({ x, z: z - sz * 0.1, r: 0.45 });
  }

  const keep = [];
  tmp.traverse((o) => { if (o.isMesh && o.userData.keep) keep.push(o); });
  bake(v.root, tmp);
  for (const o of keep) v.root.attach(o);
  v.root.remove(tmp);
}

function mergeAll(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return out;
}

// Château : socle rocheux, courtines crénelées, 4 tours rondes, donjon avec tourelles et bannières
function buildCastle(v, parent, cx, cz, villageHeight, put) {
  const M = v.M;
  const g = new THREE.Group();
  let top = -Infinity;
  for (let x = -14; x <= 14; x += 3.5) for (let z = -14; z <= 14; z += 3.5) top = Math.max(top, villageHeight(cx + x, cz + z));
  g.position.set(cx, top, cz);
  parent.add(g);
  const box = (w, h, d, x, y, z, mat = M.stone) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const cyl = (r0, r1, h, x, y, z, mat = M.stone, seg = 16) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const roof = new THREE.MeshStandardMaterial({ color: '#3f5f8a', roughness: 0.8 });
  const roofRed = new THREE.MeshStandardMaterial({ color: '#8a3a32', roughness: 0.8 });
  // socle rocheux (descend dans la colline)
  box(32, 14, 32, 0, -7, 0, M.stoneLight);
  const S = 13, H = 7.5, T = 1.6;
  // courtines + créneaux
  for (const [x, z, w, d] of [[0, -S, 2 * S, T], [0, S, 2 * S, T], [-S, 0, T, 2 * S], [S, 0, T, 2 * S]]) {
    const isFront = z === S;
    if (isFront) {
      // porte au sud (vers le village)
      box(S - 2.5, H, T, -(S + 2.5) / 2, H / 2, z); box(S - 2.5, H, T, (S + 2.5) / 2, H / 2, z);
      box(5, H - 4.6, T, 0, 4.6 + (H - 4.6) / 2, z);
      box(4.4, 4.5, 0.3, 0, 2.25, z + 0.4, M.planksDark);
    } else box(w, H, d, x, H / 2, z);
    const n = Math.round(Math.max(w, d) / 1.6);
    for (let i = 0; i < n; i += 2) {
      const t = -0.5 + (i + 0.5) / n;
      box(w > d ? 0.8 : T + 0.1, 0.9, w > d ? T + 0.1 : 0.8, x + (w > d ? t * w : 0), H + 0.45, z + (w > d ? 0 : t * d));
    }
  }
  // tours rondes aux coins
  for (const [x, z] of [[-S, -S], [S, -S], [-S, S], [S, S]]) {
    cyl(2.8, 3.1, H + 4, x, (H + 4) / 2, z);
    cyl(3.2, 3.2, 0.6, x, H + 4.3, z);
    for (let i = 0; i < 10; i += 2) { const a = i / 10 * Math.PI * 2; box(0.8, 0.9, 0.8, x + Math.cos(a) * 2.9, H + 5, z + Math.sin(a) * 2.9); }
    const c = cyl(0.01, 3.4, 4.2, x, H + 7, z, roof, 12);
    c.castShadow = true;
    for (const a of [0.4, 2.5, 4.4]) box(0.5, 0.8, 0.2, x + Math.cos(a) * 2.95, H + 1.6, z + Math.sin(a) * 2.95, M.window).lookAt(g.position.x + x * 2, H + 1.6, g.position.z + z * 2);
  }
  // donjon
  const KH = 16;
  box(10, KH, 10, 0, KH / 2, -2);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
    const t = -4.2 + i * 1.7;
    box(0.9, 1, 0.9, t, KH + 0.5, -2 + s * 4.6); box(0.9, 1, 0.9, s * 4.6, KH + 0.5, -2 + t);
  }
  for (const [x, z] of [[-5, -7], [5, -7], [-5, 3], [5, 3]]) {
    cyl(1.3, 1.3, 4, x, KH + 2, z);
    cyl(0.01, 1.7, 3.2, x, KH + 5.6, z, roofRed, 10);
  }
  for (let y = 4; y < KH - 2; y += 4) for (const x of [-3, 0, 3]) box(0.7, 1.2, 0.2, x, y, 3.05, M.window);
  // escalier vers la porte
  for (let i = 0; i < 6; i++) box(5.5, 0.4, 1, 0, -0.2 - i * 0.4, S + 1.2 + i, M.stoneLight);
  // bannières sur le donjon et au-dessus de la porte
  const ban = (name, x, y, z, ry, s) => {
    const o = prop(name, s);
    o.position.set(x, y, z); o.rotation.y = ry;
    o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.side = THREE.DoubleSide; m.userData.keep = true; } });
    g.add(o);
  };
  ban('d_banner_red', -2.5, KH - 4.6, 3.12, 0, 1.3);
  ban('d_banner_blue', 2.5, KH - 4.6, 3.12, 0, 1.3);
  ban('d_banner_shield_red', 0, H - 2.4, S + 0.85, 0, 1.0);
  // mât et drapeau en haut du donjon
  cyl(0.08, 0.08, 4, 0, KH + 3, -2, M.log, 6);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshStandardMaterial({ color: '#c0392b', side: THREE.DoubleSide }));
  flag.position.set(1.1, KH + 4.3, -2);
  flag.userData.keep = true;
  g.add(flag);
  v.castleFlag = flag;
  void put;
}
