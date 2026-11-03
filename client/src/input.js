// Teclado + mouse (pointer lock). Rotação de câmera é separada do movimento do corpo.
export class Input {
  constructor(el) {
    this.el = el; this.keys = new Set(); this.dx = 0; this.dy = 0; this.locked = false; this.handlers = {};
    this.crouchToggle = false; this.enabled = false;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') e.preventDefault(); // evita atalhos do navegador quando possível
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.crouchToggle = !this.crouchToggle;
      this.fire('key', e.code);
    }, { capture: true });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => { if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; } });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (was && !this.locked) this.fire('unlock');
      if (this.locked) { try { navigator.keyboard && navigator.keyboard.lock && navigator.keyboard.lock(['KeyW', 'Escape']).catch(() => { }); } catch { } }
    });
    el.addEventListener('mousedown', (e) => { if (this.locked) this.fire('mouse', e.button); });
  }
  on(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  fire(t, v) { for (const fn of this.handlers[t] || []) fn(v); }
  lock() { try { const p = this.el.requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch { } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code); }
  get crouch() { return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.crouchToggle; }
  get run() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
  move() {
    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    return { f, s };
  }
  takeMouse() { const d = { x: this.dx, y: this.dy }; this.dx = 0; this.dy = 0; return d; }
}
