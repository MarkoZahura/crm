/* ==========================================================================
   year-share.js — «Мій рік», етап 2 (05.11.2026): картинки «Поділитися».
   Кожна картка підсумку + загальна картинка (головні цифри року), 1080 × 1920 (як сторіз),
   ті самі кольори груп, підпис «Моя CRM · РРРР». Вимикач «Сховати суми» — гроші лише
   відсотками (памʼятається на цьому пристрої: localStorage crm.year.hideMoney).
   Малюємо самі на canvas (без SVG foreignObject — у Safari він «псує» canvas і toBlob не працює),
   іконки — з тих самих SVG-контурів (Path2D). Шрифт Inter — document.fonts.load перед малюванням.
   iPhone / телефон — navigator.share({ files }) (меню «Поділитися»), ПК — файл PNG.
   Перед надсиланням — вікно з картинкою (Safari відкриває «Поділитися» лише з натискання,
   тому картинка готується заздалегідь, а share викликається одразу в обробнику кнопки).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  if (!CRM.year) return;
  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const fmt = CRM.fmt;

  const W = 1080;
  const H = 1920;
  const PADX = 84;
  const CW = W - PADX * 2;
  const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  const SERIF = "Georgia, 'Times New Roman', serif";
  const HIDE_KEY = 'crm.year.hideMoney';
  // Кольори груп — ті самі, що в css/sections.css (:is(.yr-slide, …)[data-group])
  const PAL = {
    cover: { g1: '#6d28d9', g2: '#be185d', g3: '#c2410c', glow: '#f472b6' },
    health: { g1: '#15803d', g2: '#065f46', g3: '#064e3b', glow: '#4ade80' },
    money: { g1: '#b45309', g2: '#92400e', g3: '#7c2d12', glow: '#fbbf24' },
    work: { g1: '#1d4ed8', g2: '#1e40af', g3: '#1e3a8a', glow: '#60a5fa' },
    books: { g1: '#7e22ce', g2: '#6b21a8', g3: '#4c1d95', glow: '#c084fc' },
    records: { g1: '#be185d', g2: '#b91c1c', g3: '#9a3412', glow: '#fb923c' },
    goals: { g1: '#0f766e', g2: '#115e59', g3: '#134e4a', glow: '#5eead4' }
  };
  const pal = (g) => PAL[g] || PAL.cover;
  const WHITE = (a) => `rgba(255, 255, 255, ${a})`;
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  // Які картки йдуть на загальну картинку (до 8; далі — у звичайному порядку груп)
  const TILE_ORDER = ['training', 'books', 'tasks', 'habits', 'money', 'tutor', 'learning', 'food', 'people', 'spend'];
  const MAX_TILES = 8;

  // ---------- Налаштування пристрою ----------
  function hideMoney() {
    try { return localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { return false; }
  }
  function setHideMoney(v) {
    try { if (v) localStorage.setItem(HIDE_KEY, '1'); else localStorage.removeItem(HIDE_KEY); } catch (e) { /* лише на цей раз */ }
  }

  // ---------- Можливості браузера ----------
  let shareOk = null;
  /** Чи вміє браузер ділитися файлами (iPhone, Android, частина ПК). */
  function canShareFiles() {
    if (shareOk != null) return shareOk;
    try {
      const f = new File([new Blob(['x'], { type: 'image/png' })], 'test.png', { type: 'image/png' });
      shareOk = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [f] }));
    } catch (e) { shareOk = false; }
    return shareOk;
  }
  const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  const isPhone = () => mq('(max-width: 860px)') || mq('(pointer: coarse)');

  let fontsP = null;
  /** Inter (з кирилицею) — перед малюванням; без інтернету — системний шрифт (не довше 1,5 с). */
  function fontsReady() {
    if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
    if (!fontsP) {
      const sample = 'Мій рік 2026 ₴ % «»';
      fontsP = Promise.all([400, 600, 700].map((w) => document.fonts.load(`${w} 48px Inter`, sample).catch(() => null))).catch(() => null);
    }
    return Promise.race([fontsP, new Promise((r) => setTimeout(r, 1500))]);
  }

  // ---------- Малювання: основа ----------
  function painter(ctx) {
    const texts = [];
    return {
      ctx, texts,
      font(size, weight, family, style) {
        ctx.font = `${style ? style + ' ' : ''}${weight || 400} ${Math.max(1, Math.round(size))}px ${family || SANS}`;
      },
      spacing(px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(px * 10) / 10}px`; },
      text(t, x, y, align) {
        ctx.textAlign = align || 'left';
        ctx.fillText(t, x, y);
        texts.push(t);
      },
      width(t) { return ctx.measureText(t).width; }
    };
  }

  /** Перенесення рядків (лише за звичайними пробілами — нерозривні в сумах лишаються). */
  function wrap(p, text, maxW, maxLines) {
    const words = String(text == null ? '' : text).split(/[ \t\n]+/).filter(Boolean);
    const lines = [];
    let cur = '';
    words.forEach((w0) => {
      let w = w0;
      while (p.width(w) > maxW && w.length > 1) {
        let k = w.length - 1;
        while (k > 1 && p.width(w.slice(0, k)) > maxW) k -= 1;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, k));
        w = w.slice(k);
      }
      const t = cur ? `${cur} ${w}` : w;
      if (!cur || p.width(t) <= maxW) cur = t;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) {
      const cut = lines.slice(0, maxLines);
      let last = cut[maxLines - 1];
      while (last.length > 1 && p.width(last + '…') > maxW) last = last.slice(0, -1).replace(/\s+$/, '');
      cut[maxLines - 1] = last + '…';
      return cut;
    }
    return lines;
  }
  function ellipsize(p, text, maxW) {
    let t = String(text || '');
    if (p.width(t) <= maxW) return t;
    while (t.length > 1 && p.width(t + '…') > maxW) t = t.slice(0, -1);
    return t.replace(/\s+$/, '') + '…';
  }

  function rr(ctx, x, y, w, hh, r) {
    const rad = Math.max(0, Math.min(r, w / 2, hh / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + hh, rad);
    ctx.arcTo(x + w, y + hh, x, y + hh, rad);
    ctx.arcTo(x, y + hh, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
  function circle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }

  /** Іконка CRM (лінійна, 24×24) — тими самими контурами, що й на сторінці. */
  function drawIcon(ctx, name, cx, cy, size, color) {
    let svg = null;
    try { svg = CRM.icon(name); } catch (e) { return; }
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    Array.from(svg.children).forEach((el) => {
      const a = (n) => Number(el.getAttribute(n)) || 0;
      const tag = el.tagName.toLowerCase();
      if (tag === 'path') {
        if (typeof Path2D !== 'function') return;
        try { ctx.stroke(new Path2D(el.getAttribute('d') || '')); } catch (e) { /* пропускаємо */ }
        return;
      }
      if (tag === 'rect') rr(ctx, a('x'), a('y'), a('width'), a('height'), a('rx'));
      else if (tag === 'circle') circle(ctx, a('cx'), a('cy'), a('r'));
      else if (tag === 'ellipse') { ctx.beginPath(); ctx.ellipse(a('cx'), a('cy'), a('rx'), a('ry'), 0, 0, Math.PI * 2); }
      else return;
      ctx.stroke();
    });
    ctx.restore();
  }

  /** Тло як у картки: градієнт 158°, сяйво з правого верхнього кута, два кола внизу праворуч. */
  function background(ctx, group) {
    const c = pal(group);
    const ang = 158 * Math.PI / 180;
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    const len = Math.abs(W * dx) + Math.abs(H * dy);
    const g = ctx.createLinearGradient(W / 2 - dx * len / 2, H / 2 - dy * len / 2, W / 2 + dx * len / 2, H / 2 + dy * len / 2);
    g.addColorStop(0, c.g1);
    g.addColorStop(0.62, c.g2);
    g.addColorStop(1, c.g3);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const rx = W * 1.1;
    const ry = H * 0.65;
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(rx / ry, 1);
    const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
    rg.addColorStop(0, rgba(c.glow, 0.38));
    rg.addColorStop(0.62, rgba(c.glow, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(-ry * 2, 0, ry * 2, H);
    ctx.restore();
    circle(ctx, W * 0.87, H * 1.22 - W * 0.39, W * 0.39);
    ctx.lineWidth = 5;
    ctx.strokeStyle = WHITE(0.13);
    ctx.stroke();
    circle(ctx, W * 0.85, H * 1.08 - W * 0.21, W * 0.21);
    ctx.fillStyle = WHITE(0.07);
    ctx.fill();
  }

  function kicker(p, icon, label, cy) {
    const ctx = p.ctx;
    const s = 38;
    const d = 86;
    let x = PADX;
    if (icon) {
      ctx.fillStyle = WHITE(0.2);
      circle(ctx, x + d / 2, cy, d / 2);
      ctx.fill();
      drawIcon(ctx, icon, x + d / 2, cy, 44, '#ffffff');
      x += d + 24;
    }
    p.font(s, 700);
    p.spacing(s * 0.08);
    ctx.fillStyle = '#ffffff';
    p.text(ellipsize(p, String(label || '').toUpperCase(), W - PADX - x), x, cy + s * 0.36);
    p.spacing(0);
  }
  function footer(p, y) {
    p.font(34, 600);
    p.spacing(0.7);
    p.ctx.fillStyle = WHITE(0.85);
    p.text(`Моя CRM · ${y}`, PADX, H - 104);
    p.spacing(0);
  }

  // ---------- Блоки (висота + малювання з заданого верху) ----------
  const gap = (n) => ({ h: n, draw() {} });
  function textBlock(p, text, o) {
    p.font(o.size, o.weight, o.family, o.style);
    if (o.spacing != null) p.spacing(o.spacing);
    const lines = wrap(p, text, o.w || CW, o.maxLines);
    p.spacing(0);
    const lh = o.size * (o.lh || 1.25);
    const x = o.x == null ? PADX : o.x;
    return {
      lines, lh, h: lines.length * lh,
      draw(top) {
        p.font(o.size, o.weight, o.family, o.style);
        if (o.spacing != null) p.spacing(o.spacing);
        p.ctx.fillStyle = o.color || '#ffffff';
        lines.forEach((l, i) => p.text(l, x, top + i * lh + lh / 2 + o.size * 0.36, o.align));
        p.spacing(0);
      }
    };
  }
  function numText(v, kind) {
    if (kind === 'money') return fmt.money(v, 'UAH', { decimals: 0 });
    if (kind === 'pct') return fmt.number(v, 0) + ' %';
    return fmt.number(v, 0);
  }
  /** Велике число: розмір за довжиною (як у історіях), зменшується, доки не влізе. */
  function fitSize(p, txt, size, maxW, weight, min) {
    let s = size;
    p.font(s, weight);
    p.spacing(-s * 0.03);
    while (s > (min || 40) && p.width(txt) > maxW) {
      s -= 4;
      p.font(s, weight);
      p.spacing(-s * 0.03);
    }
    p.spacing(0);
    return s;
  }
  function bigNumber(p, txt, k) {
    const len = txt.replace(/\s/g, '').length;
    const size = fitSize(p, txt, (len >= 7 ? 150 : len >= 5 ? 201 : 288) * k, CW, 800, 60);
    const lh = size * 0.95;
    return {
      h: lh,
      draw(top) {
        p.font(size, 800);
        p.spacing(-size * 0.03);
        p.ctx.fillStyle = '#ffffff';
        p.text(txt, PADX, top + lh / 2 + size * 0.36);
        p.spacing(0);
      }
    };
  }
  /** Рядок «пігулок» (чипи, порівняння) з переносом. */
  function pillRow(p, items, s, bg) {
    const ctx = p.ctx;
    p.font(s, 600);
    const ph = s * 1.8;
    const g = s * 0.45;
    const pills = items.map((t) => {
      const txt = ellipsize(p, t, CW - s * 1.7);
      return { txt, w: p.width(txt) + s * 1.7 };
    });
    const pos = [];
    let x = 0;
    let row = 0;
    pills.forEach((pl) => {
      if (x > 0 && x + pl.w > CW) { x = 0; row += 1; }
      pos.push({ pl, x, row });
      x += pl.w + g;
    });
    const rows = pills.length ? row + 1 : 0;
    return {
      h: rows ? rows * ph + (rows - 1) * g : 0,
      draw(top) {
        pos.forEach(({ pl, x: px, row: r }) => {
          const y = top + r * (ph + g);
          ctx.fillStyle = bg;
          rr(ctx, PADX + px, y, pl.w, ph, ph / 2);
          ctx.fill();
          p.font(s, 600);
          ctx.fillStyle = '#ffffff';
          p.text(pl.txt, PADX + px + s * 0.85, y + ph / 2 + s * 0.36);
        });
      }
    };
  }
  function bulletList(p, items, k) {
    const s = 48 * k;
    const g = 22 * k;
    const ind = s * 0.75;
    const blocks = items.map((t) => textBlock(p, t, { size: s, weight: 400, lh: 1.38, w: CW - ind, x: PADX + ind, maxLines: 4 }));
    return {
      h: blocks.reduce((a, b) => a + b.h, 0) + g * Math.max(0, blocks.length - 1),
      draw(top) {
        let y = top;
        blocks.forEach((b) => {
          const base = y + b.lh / 2 + s * 0.36;
          p.ctx.fillStyle = WHITE(0.7);
          circle(p.ctx, PADX + s * 0.2, base - s * 0.27, s * 0.13);
          p.ctx.fill();
          b.draw(y);
          y += b.h + g;
        });
      }
    };
  }
  /** «На що пішло»: назва, «34 % · 12 000 ₴» і смужка. */
  function barsList(p, bars, k) {
    const ctx = p.ctx;
    const s = 45 * k;
    const lh = s * 1.3;
    const barH = 20 * k;
    const gin = 14 * k;
    const g = 30 * k;
    const rowH = lh + gin + barH;
    return {
      h: bars.length * rowH + Math.max(0, bars.length - 1) * g,
      draw(top) {
        bars.forEach((b, i) => {
          const y = top + i * (rowH + g);
          const base = y + lh / 2 + s * 0.36;
          p.font(s, 400);
          const vw = p.width(b.text);
          p.font(s, 700);
          ctx.fillStyle = '#ffffff';
          p.text(ellipsize(p, b.name, CW - vw - 28 * k), PADX, base);
          p.font(s, 400);
          p.text(b.text, W - PADX, base, 'right');
          const by = y + lh + gin;
          ctx.fillStyle = WHITE(0.22);
          rr(ctx, PADX, by, CW, barH, barH / 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          rr(ctx, PADX, by, Math.max(barH, CW * Math.max(4, Math.min(100, b.pct)) / 100), barH, barH / 2);
          ctx.fill();
        });
      }
    };
  }
  function recordsList(p, recs, k) {
    const ctx = p.ctx;
    const pad = 24 * k;
    const padX = 28 * k;
    const ico = 70 * k;
    const sv = 48 * k;
    const g = 18 * k;
    const tx = PADX + padX + ico + 22 * k;
    const items = recs.map((rc) => {
      p.font(sv, 800);
      const value = ellipsize(p, rc.value, CW * 0.42);
      const vw = p.width(value);
      const tw = W - PADX - padX - vw - 22 * k - tx;
      const lab = textBlock(p, rc.label, { size: 38 * k, weight: 600, lh: 1.25, w: tw, maxLines: 2, x: tx });
      const sub = rc.sub ? textBlock(p, rc.sub, { size: 34 * k, weight: 400, lh: 1.3, w: tw, maxLines: 1, x: tx, color: WHITE(0.9) }) : null;
      const inner = lab.h + (sub ? sub.h : 0);
      return { rc, value, lab, sub, inner, hh: Math.max(ico, inner) + pad * 2 };
    });
    return {
      h: items.reduce((a, it) => a + it.hh, 0) + g * Math.max(0, items.length - 1),
      draw(top) {
        let y = top;
        items.forEach((it) => {
          ctx.fillStyle = WHITE(0.15);
          rr(ctx, PADX, y, CW, it.hh, 34 * k);
          ctx.fill();
          const cy = y + it.hh / 2;
          ctx.fillStyle = WHITE(0.22);
          circle(ctx, PADX + padX + ico / 2, cy, ico / 2);
          ctx.fill();
          drawIcon(ctx, it.rc.icon, PADX + padX + ico / 2, cy, ico * 0.52, '#ffffff');
          const t0 = cy - it.inner / 2;
          it.lab.draw(t0);
          if (it.sub) it.sub.draw(t0 + it.lab.h);
          p.font(sv, 800);
          ctx.fillStyle = '#ffffff';
          p.text(it.value, W - PADX - padX, cy + sv * 0.36, 'right');
          y += it.hh + g;
        });
      }
    };
  }
  function goalsList(p, goals, group, k) {
    const ctx = p.ctx;
    const s = 42 * k;
    const pad = 22 * k;
    const padX = 26 * k;
    const num = 56 * k;
    const mark = 56 * k;
    const g = 18 * k;
    const tx = PADX + padX + num + 22 * k;
    const tw = W - PADX - padX - (goals.ask ? mark + 22 * k : 0) - tx;
    const items = goals.list.map((it, n) => {
      const t = textBlock(p, it.text, { size: s, weight: 600, lh: 1.3, w: tw, maxLines: 3, x: tx });
      return { it, n, t, hh: Math.max(num, t.h) + pad * 2 };
    });
    return {
      h: items.reduce((a, it) => a + it.hh, 0) + g * Math.max(0, items.length - 1),
      draw(top) {
        let y = top;
        items.forEach(({ it, n, t, hh }) => {
          ctx.fillStyle = WHITE(0.15);
          rr(ctx, PADX, y, CW, hh, 28 * k);
          ctx.fill();
          const cy = y + hh / 2;
          ctx.fillStyle = WHITE(0.25);
          circle(ctx, PADX + padX + num / 2, cy, num / 2);
          ctx.fill();
          p.font(26 * k, 700);
          ctx.fillStyle = '#ffffff';
          p.text(String(n + 1), PADX + padX + num / 2, cy + 26 * k * 0.36, 'center');
          const t0 = cy - t.h / 2;
          t.draw(t0);
          if (goals.ask && it.done === false) {
            // закреслено, як на сторінці
            p.font(s, 600);
            ctx.strokeStyle = WHITE(0.7);
            ctx.lineWidth = Math.max(2, 3 * k);
            t.lines.forEach((l, i) => {
              const base = t0 + i * t.lh + t.lh / 2 + s * 0.36;
              ctx.beginPath();
              ctx.moveTo(tx, base - s * 0.3);
              ctx.lineTo(tx + p.width(l), base - s * 0.3);
              ctx.stroke();
            });
          }
          if (goals.ask && (it.done === true || it.done === false)) {
            const mx = W - PADX - padX - mark / 2;
            if (it.done) {
              ctx.fillStyle = '#ffffff';
              circle(ctx, mx, cy, mark / 2);
              ctx.fill();
              drawIcon(ctx, 'check', mx, cy, mark * 0.56, pal(group).g2);
            } else {
              ctx.strokeStyle = WHITE(0.7);
              ctx.lineWidth = Math.max(2, 3 * k);
              circle(ctx, mx, cy, mark / 2 - 1.5);
              ctx.stroke();
              drawIcon(ctx, 'x', mx, cy, mark * 0.56, '#ffffff');
            }
          }
          y += hh + g;
        });
      }
    };
  }
  function quoteBlock(p, q, k) {
    const text = '«' + String(q.text || '').replace(/^[«"„]+|[»"“]+$/g, '') + '»';
    const body = textBlock(p, text, { size: 75 * k, weight: 400, family: SERIF, style: 'italic', lh: 1.32, maxLines: 14 });
    const cap = q.source ? textBlock(p, '— ' + q.source, { size: 45 * k, weight: 600, lh: 1.3, maxLines: 3 }) : null;
    const g = 36 * k;
    return {
      h: body.h + (cap ? g + cap.h : 0),
      draw(top) {
        body.draw(top);
        if (cap) cap.draw(top + body.h + g);
      }
    };
  }

  /** Блоки картки при масштабі k (1 — як в історіях; менше — якщо не влазить). */
  function cardBlocks(p, card, k) {
    const B = [];
    if (card.quote) {
      B.push(quoteBlock(p, card.quote, k));
    } else {
      if (card.value != null && !card.big) B.push(bigNumber(p, numText(card.value, card.num), k));
      else if (card.big) B.push(textBlock(p, card.big, { size: 107 * k, weight: 800, lh: 1.08, maxLines: 3, spacing: -107 * k * 0.02 }));
      if (card.unit) { B.push(gap(14 * k)); B.push(textBlock(p, card.unit, { size: 67 * k, weight: 600, lh: 1.25, maxLines: 3 })); }
      if (card.cmp) { B.push(gap(26 * k)); B.push(pillRow(p, [card.cmp.text], 42 * k, WHITE(0.22))); }
    }
    if (card.lines && card.lines.length) { B.push(gap(52 * k)); B.push(bulletList(p, card.lines, k)); }
    if (card.bars && card.bars.length) { B.push(gap(52 * k)); B.push(barsList(p, card.bars, k)); }
    if (card.records && card.records.length) { B.push(gap(44 * k)); B.push(recordsList(p, card.records, k)); }
    if (card.goals && card.goals.list && card.goals.list.length) { B.push(gap(44 * k)); B.push(goalsList(p, card.goals, card.group, k)); }
    return B;
  }
  const total = (B) => B.reduce((a, b) => a + b.h, 0);

  function drawCard(p, card, y) {
    const ctx = p.ctx;
    background(ctx, card.group);
    kicker(p, card.icon, card.kicker, 176);
    const top = 300;
    const bottom = H - 200;
    let k = 1;
    let B = cardBlocks(p, card, k);
    while (total(B) > bottom - top && k > 0.5) {
      k = Math.round((k - 0.05) * 100) / 100;
      B = cardBlocks(p, card, k);
    }
    let yy = top + Math.max(0, (bottom - top - total(B)) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 250, W, H - 170 - 250);
    ctx.clip();
    B.forEach((b) => { b.draw(yy); yy += b.h; });
    ctx.restore();
    footer(p, y);
  }

  // ---------- Загальна картинка ----------
  function overallTiles(y, opts) {
    const cards = CRM.year.cardsFor(y, opts).filter((c) => c.value != null && !c.big && !c.quote);
    const pick = TILE_ORDER.map((id) => cards.find((c) => c.id === id)).filter(Boolean).slice(0, MAX_TILES);
    return cards.filter((c) => pick.includes(c));
  }
  function tileLayout(p, t, w, k) {
    const pad = 34 * k;
    const ks = 27 * k;
    const ico = 50 * k;
    const inner = w - pad * 2;
    const txt = numText(t.value, t.num);
    const vs = fitSize(p, txt, 104 * k, inner, 800, 30);
    const unit = t.unit ? textBlock(p, t.unit, { size: 33 * k, weight: 600, lh: 1.22, w: inner, maxLines: 2 }) : null;
    const hh = pad + ico + 24 * k + vs * 0.95 + (unit ? 12 * k + unit.h : 0) + pad;
    return { t, txt, vs, unit, pad, ks, ico, hh };
  }
  function drawTile(p, L, x, y, w, hh) {
    const ctx = p.ctx;
    const c = pal(L.t.group);
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    const g = ctx.createLinearGradient(x, y, x + w, y + hh);
    g.addColorStop(0, c.g1);
    g.addColorStop(1, c.g3);
    ctx.fillStyle = g;
    rr(ctx, x, y, w, hh, 40);
    ctx.fill();
    ctx.restore();
    // сяйво кольору групи в куті плитки
    ctx.save();
    rr(ctx, x, y, w, hh, 40);
    ctx.clip();
    const rg = ctx.createRadialGradient(x + w, y, 0, x + w, y, w * 0.9);
    rg.addColorStop(0, rgba(c.glow, 0.35));
    rg.addColorStop(1, rgba(c.glow, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(x, y, w, hh);
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = WHITE(0.16);
    rr(ctx, x + 1, y + 1, w - 2, hh - 2, 39);
    ctx.stroke();
    const ix = x + L.pad;
    let yy = y + L.pad;
    ctx.fillStyle = WHITE(0.2);
    circle(ctx, ix + L.ico / 2, yy + L.ico / 2, L.ico / 2);
    ctx.fill();
    drawIcon(ctx, L.t.icon, ix + L.ico / 2, yy + L.ico / 2, L.ico * 0.54, '#ffffff');
    p.font(L.ks, 700);
    p.spacing(L.ks * 0.08);
    ctx.fillStyle = '#ffffff';
    p.text(ellipsize(p, String(L.t.kicker).toUpperCase(), w - L.pad * 2 - L.ico - 16), ix + L.ico + 16, yy + L.ico / 2 + L.ks * 0.36);
    p.spacing(0);
    yy += L.ico + 24 * (L.ks / 27);
    p.font(L.vs, 800);
    p.spacing(-L.vs * 0.03);
    p.text(L.txt, ix, yy + L.vs * 0.95 / 2 + L.vs * 0.36);
    p.spacing(0);
    yy += L.vs * 0.95;
    if (L.unit) {
      yy += 12 * (L.ks / 27);
      const u = L.unit;
      p.font(33 * (L.ks / 27), 600);
      ctx.fillStyle = WHITE(0.92);
      u.lines.forEach((l, i) => p.text(l, ix, yy + i * u.lh + u.lh / 2 + 33 * (L.ks / 27) * 0.36));
    }
  }
  function drawOverall(p, y, opts) {
    const ctx = p.ctx;
    background(ctx, 'cover');
    const info = CRM.year.coverInfo(y);
    kicker(p, 'sparkles', 'Моя CRM', 176);
    let yy = 286;
    const title = textBlock(p, info.title, { size: 170, weight: 800, lh: 1, maxLines: 1, spacing: -170 * 0.02 });
    title.draw(yy);
    yy += title.h;
    const since = [info.since, info.partial].filter(Boolean).join(' · ');
    if (since) {
      yy += 20;
      const s = textBlock(p, since, { size: 46, weight: 600, lh: 1.3, maxLines: 2 });
      s.draw(yy);
      yy += s.h;
    }
    const tiles = overallTiles(y, opts);
    const areaTop = yy + 70;
    const areaBottom = H - 190;
    if (!tiles.length) {
      const e = textBlock(p, 'Даних за цей рік ще немає', { size: 56, weight: 600, lh: 1.3, maxLines: 2 });
      e.draw(areaTop + (areaBottom - areaTop - e.h) / 2);
      footer(p, y);
      return;
    }
    const g = 28;
    const colW = (CW - g) / 2;
    const layoutAt = (k) => {
      const rows = [];
      for (let i = 0; i < tiles.length; i += 2) {
        const pair = tiles.slice(i, i + 2);
        const full = pair.length === 1;
        const Ls = pair.map((t) => tileLayout(p, t, full ? CW : colW, k));
        rows.push({ Ls, full, hh: Math.max(...Ls.map((L) => L.hh)) });
      }
      return { rows, h: rows.reduce((a, r) => a + r.hh, 0) + g * (rows.length - 1) };
    };
    let k = 1.2;
    let lay = layoutAt(k);
    while (lay.h > areaBottom - areaTop && k > 0.5) {
      k = Math.round((k - 0.05) * 100) / 100;
      lay = layoutAt(k);
    }
    let ty = areaTop + Math.max(0, (areaBottom - areaTop - lay.h) / 2);
    lay.rows.forEach((r) => {
      r.Ls.forEach((L, j) => drawTile(p, L, PADX + (r.full ? 0 : j * (colW + g)), ty, r.full ? CW : colW, r.hh));
      ty += r.hh + g;
    });
    footer(p, y);
  }

  // ---------- Картинка ----------
  function fileName(y, cardId) { return `moya-crm-${y}${cardId ? '-' + cardId : ''}.png`; }
  function toBlob(canvas) {
    return new Promise((resolve, reject) => {
      try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'); } catch (e) { reject(e); }
    });
  }
  /**
   * Намалювати картинку. cardId — id картки з CRM.year.cardsFor (null — загальна).
   * → { blob, canvas, texts (усі написані рядки), name, card }
   */
  async function render(y, cardId, opts) {
    const o = { hideMoney: !!(opts && opts.hideMoney) };
    await fontsReady();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const p = painter(ctx);
    let card = null;
    if (cardId) {
      card = CRM.year.cardsFor(y, o).find((c) => c.id === cardId) || null;
      if (!card) throw new Error('Картки немає');
      drawCard(p, card, y);
    } else {
      drawOverall(p, y, o);
    }
    const blob = await toBlob(canvas);
    return { blob, canvas, texts: p.texts, name: fileName(y, cardId), card };
  }
  /** Чи є на картинці суми (тоді показуємо вимикач «Сховати суми»). */
  function hasMoney(y, cardId) {
    if (cardId) {
      const c = CRM.year.cardsFor(y).find((x) => x.id === cardId);
      return !!(c && c.money);
    }
    return overallTiles(y).some((c) => c.money && c.num === 'money');
  }

  // ---------- Вікно «Поділитися» ----------
  let active = null;
  function open(y, cardId) {
    const base = cardId ? CRM.year.cardsFor(y).find((c) => c.id === cardId) : null;
    if (cardId && !base) { ui.toast('Цієї картки вже немає'); return null; }
    const withMoney = hasMoney(y, cardId);
    let hide = withMoney && hideMoney();
    let cur = null;
    let token = 0;
    const label = cardId ? base.kicker : `Мій ${y}`;

    const img = h('img', { class: 'yr-sh-img', alt: `Картинка «${label}»`, hidden: true });
    const wait = h('div', { class: 'yr-sh-wait', role: 'status' }, 'Малюю картинку…');
    const preview = h('div', { class: 'yr-sh-preview is-busy', dataset: { group: cardId ? base.group : 'cover' } }, wait, img);

    let sw = null;
    let optRow = null;
    if (withMoney) {
      const lblId = 'yr-sh-' + CRM.utils.uid().slice(0, 6);
      sw = h('button', { type: 'button', class: 'hs-switch yr-sh-switch', role: 'switch', 'aria-checked': hide ? 'true' : 'false', 'aria-labelledby': lblId,
        onClick: () => toggle() });
      optRow = h('div', { class: 'yr-sh-opt' }, sw,
        h('span', { class: 'yr-sh-opt-text', id: lblId, onClick: () => toggle() },
          h('span', { class: 'yr-sh-opt-title' }, 'Сховати суми'),
          h('span', { class: 'yr-sh-opt-sub' }, 'Гроші — лише у відсотках')));
    }
    function toggle() {
      hide = !hide;
      setHideMoney(hide);
      sw.setAttribute('aria-checked', hide ? 'true' : 'false');
      draw();
    }

    const shareFiles = canShareFiles();
    const shareFirst = shareFiles && isPhone();
    const shareBtn = shareFiles ? ui.button({ label: 'Поділитися…', icon: 'share', variant: shareFirst ? 'primary' : null, className: 'yr-sh-share', disabled: true, onClick: () => doShare() }) : null;
    const saveBtn = ui.button({ label: 'Зберегти картинку', icon: 'download', variant: shareFirst ? null : 'primary', className: 'yr-sh-save', disabled: true, onClick: () => doSave() });
    const note = h('p', { class: 'yr-sh-note' }, shareFirst
      ? 'Картинка 1080 × 1920, як сторіз. «Поділитися…» — Telegram, Instagram або «Зберегти зображення» (у «Фото»).'
      : 'Картинка 1080 × 1920, як сторіз. «Зберегти картинку» — файл PNG у папці «Завантаження».');

    function setReady(ok) {
      saveBtn.disabled = !ok;
      if (shareBtn) shareBtn.disabled = !ok;
    }
    async function draw() {
      const my = ++token;
      preview.classList.add('is-busy');
      setReady(false);
      try {
        const r = await render(y, cardId, { hideMoney: hide });
        if (my !== token || !dlg.isOpen) return;
        if (cur) URL.revokeObjectURL(cur.url);
        let file = null;
        try { file = new File([r.blob], r.name, { type: 'image/png' }); } catch (e) { file = null; }
        cur = { blob: r.blob, file, name: r.name, url: URL.createObjectURL(r.blob), texts: r.texts, hide };
        img.src = cur.url;
        img.hidden = false;
        wait.hidden = true;
        preview.classList.remove('is-busy');
        setReady(true);
      } catch (e) {
        if (my !== token) return;
        wait.textContent = 'Не вдалося намалювати картинку';
        wait.hidden = false;
        preview.classList.remove('is-busy');
      }
    }
    // Викликається прямо з натискання (без await перед share) — інакше Safari не відкриє меню
    function doShare() {
      if (!cur || !cur.file) return;
      let pr;
      try { pr = navigator.share({ files: [cur.file] }); } catch (e) { pr = Promise.reject(e); }
      Promise.resolve(pr).catch((e) => {
        if (e && e.name === 'AbortError') return; // людина закрила меню
        ui.toast('Не вдалося відкрити «Поділитися». Збережи картинку кнопкою «Зберегти картинку».', { type: 'error' });
      });
    }
    function doSave() {
      if (!cur) return;
      const a = h('a', { href: cur.url, download: cur.name, hidden: true });
      document.body.appendChild(a);
      a.click();
      a.remove();
      ui.toast(`Картинку збережено: ${cur.name}`, { type: 'success' });
    }

    const footerBtns = [ui.button({ label: 'Закрити', className: 'yr-sh-close', onClick: () => dlg.close('button') })];
    if (shareFirst) footerBtns.push(saveBtn, shareBtn); else footerBtns.push(shareBtn, saveBtn);
    const dlg = ui.modal({
      title: cardId ? `Поділитися: ${label}` : `Поділитися: Мій ${y}`, size: 'sm', className: 'yr-share-modal',
      body: [preview, optRow, note], footer: footerBtns.filter(Boolean),
      initialFocus: 'container',
      onClose: () => {
        token += 1;
        if (cur) URL.revokeObjectURL(cur.url);
        cur = null;
        if (active && active.dlg === dlg) active = null;
      }
    });
    active = { dlg, y, cardId: cardId || null, get current() { return cur; }, get hide() { return hide; } };
    draw();
    return dlg;
  }

  CRM.yearShare = {
    W, H, HIDE_KEY, open, render, hideMoney, setHideMoney, canShareFiles, hasMoney, overallTiles, fileName,
    /** Відкрите вікно (для перевірок): { y, cardId, hide, current: { name, texts, blob, hide } } */
    get active() { return active; }
  };
})(window.CRM);
