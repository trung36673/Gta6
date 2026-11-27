#!/usr/bin/env python3
"""Re-pack a GLB for mobile: drop unused attributes/maps/meshes, shrink textures.
usage: optimize_glb.py in.glb out.glb [--maxtex 1024] [--keep-normal] [--drop-meshes 39,40]
"""
import struct, json, sys, io, argparse
from PIL import Image

def read(p):
    d = open(p, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20+jl])
    off = 20 + jl
    bl = struct.unpack('<I', d[off:off+4])[0]
    bin_ = d[off+8:off+8+bl]
    return j, bin_

def pad4(b, c=b'\0'):
    return b + c * ((4 - len(b) % 4) % 4)

def write(p, j, bin_):
    js = pad4(json.dumps(j, separators=(',', ':')).encode(), b' ')
    bn = pad4(bin_)
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(p, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(bn), b'BIN\0')); f.write(bn)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inp'); ap.add_argument('out')
    ap.add_argument('--maxtex', type=int, default=1024)
    ap.add_argument('--keep-normal', action='store_true')
    ap.add_argument('--drop-meshes', default='')
    ap.add_argument('--quality', type=int, default=82)
    a = ap.parse_args()
    j, bin_ = read(a.inp)
    drop = {int(x) for x in a.drop_meshes.split(',') if x}
    # 1. drop meshes by detaching nodes
    for n in j['nodes']:
        if n.get('mesh') in drop:
            n.pop('mesh'); n.pop('skin', None)
    # 2. strip attributes
    keep_attr = {'POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'}
    if a.keep_normal: keep_attr.add('TANGENT')
    for m in j['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: v for k, v in p['attributes'].items() if k in keep_attr}
            p.pop('targets', None)
    # 3. strip material maps (keep base + emissive)
    for m in j.get('materials', []):
        m.pop('occlusionTexture', None)
        if not a.keep_normal: m.pop('normalTexture', None)
        pb = m.get('pbrMetallicRoughness', {})
        pb.pop('metallicRoughnessTexture', None)
        m.pop('extensions', None)
    # 4. reachability
    used_meshes = {n['mesh'] for n in j['nodes'] if 'mesh' in n}
    used_skins = {n['skin'] for n in j['nodes'] if 'skin' in n}
    used_mats = set(); used_acc = set()
    for mi in used_meshes:
        for p in j['meshes'][mi]['primitives']:
            if 'material' in p: used_mats.add(p['material'])
            used_acc.update(p['attributes'].values())
            if 'indices' in p: used_acc.add(p['indices'])
    for si in used_skins:
        s = j['skins'][si]
        if 'inverseBindMatrices' in s: used_acc.add(s['inverseBindMatrices'])
    used_tex = set()
    for mi in used_mats:
        m = j['materials'][mi]
        pb = m.get('pbrMetallicRoughness', {})
        for t in (pb.get('baseColorTexture'), m.get('emissiveTexture'), m.get('normalTexture')):
            if t: used_tex.add(t['index'])
    used_img = {j['textures'][t]['source'] for t in used_tex}
    # 5. build remaps
    def remap(s): return {o: i for i, o in enumerate(sorted(s))}
    mesh_map = remap(used_meshes); skin_map = remap(used_skins)
    mat_map = remap(used_mats); acc_map = remap(used_acc)
    tex_map = remap(used_tex); img_map = remap(used_img)
    # bufferViews used
    bvs = j['bufferViews']
    used_bv = {j['accessors'][i]['bufferView'] for i in used_acc if 'bufferView' in j['accessors'][i]}
    img_bv = {j['images'][i]['bufferView'] for i in used_img}
    new_bin = bytearray(); bv_new = []; bv_map = {}
    for oi in sorted(used_bv):
        b = bvs[oi]
        chunk = bin_[b.get('byteOffset', 0): b.get('byteOffset', 0) + b['byteLength']]
        off = len(new_bin)
        new_bin += chunk
        while len(new_bin) % 4: new_bin.append(0)
        nb = {k: v for k, v in b.items() if k != 'byteOffset'}
        nb['buffer'] = 0; nb['byteOffset'] = off
        bv_map[oi] = len(bv_new); bv_new.append(nb)
    # images: re-encode
    img_new = []
    for oi in sorted(used_img):
        im = j['images'][oi]; b = bvs[im['bufferView']]
        raw = bin_[b.get('byteOffset', 0): b.get('byteOffset', 0) + b['byteLength']]
        I = Image.open(io.BytesIO(raw))
        has_alpha = False
        if I.mode in ('P', 'PA', 'LA', 'RGBA') or 'transparency' in I.info:
            I = I.convert('RGBA')
            has_alpha = I.getchannel('A').getextrema()[0] < 250
        else:
            I = I.convert('RGB')
        if max(I.size) > a.maxtex:
            r = a.maxtex / max(I.size)
            I = I.resize((max(1, int(I.width * r)), max(1, int(I.height * r))), Image.LANCZOS)
        out = io.BytesIO()
        if has_alpha:
            I.save(out, 'PNG', optimize=True); mime = 'image/png'
        else:
            I.convert('RGB').save(out, 'JPEG', quality=a.quality, optimize=True); mime = 'image/jpeg'
        data = out.getvalue()
        off = len(new_bin); new_bin += data
        while len(new_bin) % 4: new_bin.append(0)
        bv_new.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
        img_new.append({'bufferView': len(bv_new) - 1, 'mimeType': mime, 'name': im.get('name', '')})
        print('  img', oi, I.size, mime, len(data) // 1024, 'KB', 'alpha' if has_alpha else '')
    # accessors
    acc_new = []
    for oi in sorted(used_acc):
        ac = dict(j['accessors'][oi])
        if 'bufferView' in ac: ac['bufferView'] = bv_map[ac['bufferView']]
        acc_new.append(ac)
    # textures
    tex_new = []
    for oi in sorted(used_tex):
        t = dict(j['textures'][oi]); t['source'] = img_map[t['source']]; tex_new.append(t)
    # materials
    mat_new = []
    for oi in sorted(used_mats):
        m = json.loads(json.dumps(j['materials'][oi]))
        pb = m.get('pbrMetallicRoughness', {})
        for holder in (pb, m):
            for k in ('baseColorTexture', 'emissiveTexture', 'normalTexture'):
                if k in holder: holder[k]['index'] = tex_map[holder[k]['index']]
        mat_new.append(m)
    # meshes
    mesh_new = []
    for oi in sorted(used_meshes):
        m = json.loads(json.dumps(j['meshes'][oi]))
        for p in m['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p: p['indices'] = acc_map[p['indices']]
            if 'material' in p: p['material'] = mat_map[p['material']]
        mesh_new.append(m)
    skin_new = []
    for oi in sorted(used_skins):
        s = dict(j['skins'][oi])
        if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]
        skin_new.append(s)
    for n in j['nodes']:
        if 'mesh' in n: n['mesh'] = mesh_map[n['mesh']]
        if 'skin' in n: n['skin'] = skin_map[n['skin']]
    out = {'asset': {'version': '2.0', 'generator': 'optimize_glb'}, 'scene': 0, 'scenes': j['scenes'], 'nodes': j['nodes'],
           'meshes': mesh_new, 'accessors': acc_new, 'bufferViews': bv_new, 'buffers': [{'byteLength': len(new_bin)}],
           'materials': mat_new}
    if tex_new: out['textures'] = tex_new
    if img_new: out['images'] = img_new
    if skin_new: out['skins'] = skin_new
    if 'samplers' in j: out['samplers'] = j['samplers']
    write(a.out, out, bytes(new_bin))
    print(a.inp.split('/')[-1], '->', len(new_bin) // 1024, 'KB bin')

main()
