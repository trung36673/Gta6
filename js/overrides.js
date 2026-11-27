// material tweaks for the supplied models
export function luciaOverrides(mat) {
  const n = mat.name;
  mat.spec = 0.06; mat.shin = 18; mat.ds = true;
  if (/Eyelashes/.test(n)) { mat.base = null; mat.baseCol = [0.02, 0.015, 0.015, 1]; }
  else if (/Lips/.test(n)) { mat.baseCol = [0.62, 0.12, 0.22, 1]; mat.spec = 0.3; }
  else if (/EyeColor/.test(n)) { mat.baseCol = [0.2, 0.42, 0.55, 1]; }
  else if (/EyeREF/.test(n)) { mat.hidden = true; }
  else if (/Eyeballs/.test(n)) { mat.baseCol = [0.92, 0.92, 0.95, 1]; }
  else if (/Eyecorner/.test(n)) { mat.baseCol = [0.7, 0.45, 0.42, 1]; }
  else if (/Earrings/.test(n)) { mat.baseCol = mat.base ? mat.baseCol : [0.9, 0.7, 0.3, 1]; mat.spec = 0.8; mat.shin = 60; }
  else if (/Nails/.test(n)) { mat.baseCol = [0.9, 0.2, 0.5, 1]; mat.spec = 0.4; }
  else if (/Bra\.03/.test(n)) { mat.baseCol = [0.05, 0.05, 0.06, 1]; }
  else if (/Shorts\.03/.test(n)) { mat.baseCol = [0.12, 0.2, 0.36, 1]; }
  else if (/Hair/.test(n)) { mat.spec = 0.35; mat.shin = 40; }
  else if (/Panties|Teeth/.test(n)) { mat.spec = 0.1; }
  // hide leftover weapon-bound meshes if any survived
  if (/Weapon/.test(n)) mat.hidden = true;
}
export function boardOverrides(mat) { mat.ds = true; mat.glow = 1.15; mat.spec = 0.0; }
export function manholeOverrides(mat) { mat.ds = true; mat.spec = 0.5; mat.shin = 30; mat.wet = 0.5; }
export function uspOverrides(mat) { mat.ds = true; mat.spec = 0.8; mat.shin = 40; mat.baseCol = [1.35, 1.35, 1.4, 1]; }
export function japanOverrides(mat) { mat.ds = true; mat.spec = 0.1; mat.glow = 0.0; mat.emisCol = [0.75, 0.75, 0.75]; }
