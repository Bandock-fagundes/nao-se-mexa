import * as THREE from 'three';
import { buildTextures } from './textures.js';

// Materiais compartilhados. vertexColors permite AO assado e tintas por vértice.
export function buildMaterials(texSize = 512) {
  const T = buildTextures(texSize);
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const M = { T };
  M.floorWood = std({ ...T.woodFloor, roughness: 0.75, metalness: 0.02 });
  M.floorStone = std({ ...T.stone, roughness: 1, color: 0x9a968e });
  M.floorTile = std({ ...T.tile, roughness: 0.6 });
  M.floorCarpet = std({ ...T.carpetFloor, roughness: 1 });
  M.floorPlanks = std({ ...T.planks, roughness: 0.95 });
  M.floorMarble = std({ ...T.marble, roughness: 0.75, metalness: 0.0 });
  M.brick = std({ ...T.brick, roughness: 1 });
  M.agedWood = std({ ...T.agedWood, roughness: 0.82, color: 0xffffff }); M.agedWood.normalScale.set(0.55, 0.55);
  M.wallRed = std({ ...T.wallRed, roughness: 0.92 });
  M.wallGreen = std({ ...T.wallGreen, roughness: 0.92 });
  M.wallBlue = std({ ...T.wallBlue, roughness: 0.92 });
  M.wallGold = std({ ...T.wallGold, roughness: 0.92 });
  M.wallPlain = std({ ...T.wallPlain, roughness: 0.95 });
  M.wallTile = std({ ...T.tile, roughness: 0.55, color: 0xcfd6d0 });
  M.wainscot = std({ ...T.wainscot, roughness: 0.75 });
  M.stone = std({ ...T.stone, roughness: 1 });
  M.planks = std({ ...T.planks, roughness: 0.95 });
  M.ceiling = std({ ...T.ceiling, roughness: 1 });
  M.ceilingDark = std({ ...T.ceiling, roughness: 1, color: 0x6a645c });
  M.trim = std({ ...T.furnWood, roughness: 0.55, color: 0x3a2214 });
  M.wood = std({ ...T.furnWood, roughness: 0.6, color: 0x7a5236 });
  M.darkWood = std({ ...T.furnWood, roughness: 0.55, color: 0x3c2416 });
  M.paleWood = std({ ...T.furnWood, roughness: 0.7, color: 0xa08060 });
  M.fabric = std({ ...T.fabric, roughness: 1, color: 0xffffff });
  M.metal = std({ ...T.metal, roughness: 0.6, metalness: 0.7, color: 0x8a8580 });
  M.iron = std({ ...T.metal, roughness: 0.5, metalness: 0.8, color: 0x3a3836 });
  M.brass = std({ color: 0xb08a3a, roughness: 0.32, metalness: 0.95 });
  M.porcelain = std({ color: 0xe8e4d8, roughness: 0.25, metalness: 0.0 });
  // v3: mármore fosco do busto — a porcelana brilhante estourava em branco sob a lanterna
  M.marble = std({ color: 0x75726c, roughness: 0.7, metalness: 0.0 });
  M.paper = std({ color: 0xcfc2a0, roughness: 1 });
  M.books = std({ ...T.furnWood, roughness: 0.8, color: 0xffffff });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x8090a0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, vertexColors: true });
  M.bottleGlass = std({ color: 0x1e3a22, roughness: 0.1, metalness: 0.1 });
  M.glow = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb060, emissiveIntensity: 1.6 });
  M.glowRed = new THREE.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff2010, emissiveIntensity: 4 });
  M.fire = new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  M.shade = new THREE.MeshStandardMaterial({ color: 0xe8c890, emissive: 0xff9a40, emissiveIntensity: 0.32, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
  M.sheet = std({ ...T.fabric, roughness: 1, color: 0xb8b2a4 });
  M.curtain = new THREE.MeshStandardMaterial({ ...T.fabric, color: 0x5a1416, roughness: 1, side: THREE.DoubleSide });
  M.black = std({ color: 0x0a0807, roughness: 0.9 });
  M.soot = std({ color: 0x141210, roughness: 1 });
  M.windowGlass = new THREE.MeshStandardMaterial({ map: nightWindowTexture(), emissive: 0x6a88c0, emissiveMap: null, emissiveIntensity: 0.0, roughness: 0.1 });
  M.windowGlass.emissiveMap = M.windowGlass.map; M.windowGlass.emissiveIntensity = 0.9;
  M.gold = new THREE.MeshStandardMaterial({ color: 0xd8a840, metalness: 1, roughness: 0.25, emissive: 0x442200, emissiveIntensity: 0.6 });
  M.green = std({ color: 0x2a4a22, roughness: 0.9 });
  M.leather = std({ ...T.fabric, color: 0x3a2014, roughness: 0.7 });
  return M;
}

function nightWindowTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#1a2a4a'); gr.addColorStop(0.7, '#0c1424'); gr.addColorStop(1, '#05070c');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(220,230,255,0.9)'; g.beginPath(); g.arc(96, 40, 10, 0, 7); g.fill();
  g.strokeStyle = '#020305'; g.lineWidth = 3;
  for (let i = 0; i < 5; i++) { g.beginPath(); let x = 10 + i * 26, y = 256; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.sin(i * 7 + k) * 10); y -= 22; g.lineTo(x, y); } g.stroke(); }
  g.fillStyle = '#020305'; g.fillRect(0, 210, 128, 46);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
