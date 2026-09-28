/* ==========================================================================
   charts.js — обгортка над Chart.js: однаковий вигляд діаграм, кольори
   для світлої й темної теми, підказки «спершу значення, потім назва».
   Chart.js завантажується з CDN асинхронно; поки його немає (або немає
   інтернету) — показуємо зрозумілу заглушку.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h } = CRM.ui;
  const instances = new Set();

  function available() { return typeof window.Chart === 'function'; }
  function failed() { return !!window.__crmChartsFailed; }

  /** Кольори з CSS-змінних поточної теми. */
  function theme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), border: v('--border'), surface: v('--surface'), font: v('--font') };
  }

  function applyDefaults() {
    if (!available()) return;
    const t = theme();
    const C = window.Chart;
    C.defaults.font.family = t.font || 'Inter, system-ui, sans-serif';
    C.defaults.font.size = 12;
    C.defaults.color = t.text2;
    C.defaults.borderColor = t.border;
    C.defaults.animation.duration = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350;
    C.defaults.plugins.legend.display = false;
    const tt = C.defaults.plugins.tooltip;
    tt.backgroundColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#efefed' : '#1f1f1d';
    tt.titleColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1f1f1d' : '#f4f4f2';
    tt.bodyColor = tt.titleColor;
    tt.padding = 10;
    tt.cornerRadius = 8;
    tt.displayColors = true;
    tt.boxWidth = 10;
    tt.boxHeight = 2;
    tt.boxPadding = 6;
    tt.titleFont = { weight: '600', size: 13 };
    tt.bodyFont = { size: 12 };
  }

  /** Заглушка замість діаграми. */
  function placeholder(height) {
    const msg = failed()
      ? 'Діаграми недоступні: не вдалося завантажити Chart.js (немає інтернету?). Цифри нижче — актуальні.'
      : 'Завантажую діаграму…';
    return h('div', { class: 'chart-placeholder', style: { height: (height || 220) + 'px' } }, CRM.icon(failed() ? 'alert' : 'clock', { size: 'sm' }), msg);
  }

  /** Знищити всі діаграми (при перемальовуванні сторінки). */
  function destroyAll() {
    instances.forEach((c) => { try { c.destroy(); } catch (e) { /* ігноруємо */ } });
    instances.clear();
  }

  // Під час перемальовування тієї самої сторінки (напр., довантажились курси) — без анімації, щоб не блимало
  let quiet = false;
  function setQuiet(v) { quiet = v; }

  function create(canvas, config) {
    applyDefaults();
    if (quiet) { config.options = config.options || {}; config.options.animation = false; }
    const chart = new window.Chart(canvas, config);
    instances.add(chart);
    return chart;
  }

  /**
   * Кругова / кільцева діаграма.
   * opts: { labels, values, colors, doughnut, format(value) → текст, total }
   */
  function pie(opts) {
    const size = opts.size || 220;
    if (!available()) return placeholder(size);
    const t = theme();
    const wrap = h('div', { class: 'chart-pie', style: { width: size + 'px', height: size + 'px' } });
    const canvas = h('canvas', { role: 'img', 'aria-label': opts.ariaLabel || 'Діаграма' });
    wrap.appendChild(canvas);
    if (opts.center) wrap.appendChild(h('div', { class: 'chart-center' }, opts.center));
    const total = opts.values.reduce((a, b) => a + b, 0);
    // Створюємо після вставки в документ
    requestAnimationFrame(() => {
      if (!canvas.isConnected) return;
      create(canvas, {
        type: opts.doughnut ? 'doughnut' : 'pie',
        data: {
          labels: opts.labels,
          datasets: [{
            data: opts.values,
            backgroundColor: opts.colors,
            borderColor: t.surface,
            borderWidth: 2,
            hoverOffset: 6,
            hoverBorderColor: t.surface
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: opts.doughnut ? '64%' : 0,
          layout: { padding: 6 },
          plugins: {
            tooltip: {
              callbacks: {
                title: (items) => (items[0] ? (opts.format ? opts.format(items[0].raw) : String(items[0].raw)) : ''),
                label: (item) => ` ${item.label} · ${CRM.fmt.percent(total ? item.raw / total * 100 : 0)}`
              }
            }
          }
        }
      });
    });
    return wrap;
  }

  /** Колір серії даних (перший слот перевіреної палітри) для поточної теми. */
  function seriesColor(slot) {
    return CRM.dict.categoryColor(slot || 'blue');
  }
  function alpha(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /** Компактні підписи осі: 12 тис., 1,2 млн */
  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return CRM.fmt.number(v / 1e6, 1).replace(/,0$/, '') + ' млн';
    if (a >= 1e3) return CRM.fmt.number(v / 1e3, a >= 1e5 ? 0 : 1).replace(/,0$/, '') + ' тис.';
    return CRM.fmt.number(v, 0);
  }

  // Вертикальна лінія-перехрестя, що «знаходить» найближчу дату під курсором
  const crosshair = {
    id: 'crmCrosshair',
    afterDatasetsDraw(chart) {
      const active = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (!active.length || chart.config.type !== 'line') return;
      const x = active[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme().text3;
      ctx.stroke();
      ctx.restore();
    }
  };

  function axisOptions(t, fmtY, maxX) {
    return {
      x: { grid: { display: false }, border: { color: t.border }, ticks: { color: t.text3, maxRotation: 0, autoSkip: true, maxTicksLimit: maxX || 8 } },
      y: { grid: { color: t.border, drawTicks: false }, border: { display: false }, ticks: { color: t.text3, padding: 8, callback: (v) => fmtY(v), maxTicksLimit: 6 } }
    };
  }

  /**
   * Лінійна діаграма з однією серією.
   * opts: { labels, values, titles (підписи для підказки), format(value), yFormat, height, color }
   */
  function line(opts) {
    const height = opts.height || 260;
    if (!available()) return placeholder(height);
    const t = theme();
    const color = opts.color || seriesColor('blue');
    const wrap = h('div', { class: 'chart-box', style: { height: height + 'px' } });
    const canvas = h('canvas', { role: 'img', 'aria-label': opts.ariaLabel || 'Лінійна діаграма' });
    wrap.appendChild(canvas);
    requestAnimationFrame(() => {
      if (!canvas.isConnected) return;
      create(canvas, {
        type: 'line',
        data: {
          labels: opts.labels,
          datasets: [{
            data: opts.values, borderColor: color, borderWidth: 2, backgroundColor: alpha(color, 0.1), fill: 'origin',
            tension: 0.25, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: color,
            pointHoverBorderColor: t.surface, pointHoverBorderWidth: 2, pointHitRadius: 12
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: axisOptions(t, opts.yFormat || compact),
          plugins: {
            tooltip: {
              displayColors: false,
              callbacks: {
                title: (items) => (items[0] ? (opts.format ? opts.format(items[0].raw) : String(items[0].raw)) : ''),
                label: (item) => (opts.titles ? opts.titles[item.dataIndex] : item.label)
              }
            }
          }
        },
        plugins: [crosshair]
      });
    });
    return wrap;
  }

  /**
   * Стовпчикова діаграма з однією серією; виділений стовпчик — насиченим кольором.
   * opts: { labels, values, highlight (індекс), titles, format, yFormat, height }
   */
  function bar(opts) {
    const height = opts.height || 240;
    if (!available()) return placeholder(height);
    const t = theme();
    const color = opts.color || seriesColor('blue');
    const wrap = h('div', { class: 'chart-box', style: { height: height + 'px' } });
    const canvas = h('canvas', { role: 'img', 'aria-label': opts.ariaLabel || 'Стовпчикова діаграма' });
    wrap.appendChild(canvas);
    requestAnimationFrame(() => {
      if (!canvas.isConnected) return;
      create(canvas, {
        type: 'bar',
        data: {
          labels: opts.labels,
          datasets: [{
            data: opts.values,
            backgroundColor: opts.values.map((_, i) => (opts.highlight == null || i === opts.highlight ? color : alpha(color, 0.4))),
            hoverBackgroundColor: color,
            borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom',
            maxBarThickness: 24, categoryPercentage: 0.7, barPercentage: 0.9
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: axisOptions(t, opts.yFormat || compact, 12),
          plugins: {
            tooltip: {
              displayColors: false,
              callbacks: {
                title: (items) => (items[0] ? (opts.format ? opts.format(items[0].raw) : String(items[0].raw)) : ''),
                label: (item) => (opts.titles ? opts.titles[item.dataIndex] : item.label)
              }
            }
          },
          onClick: opts.onClick ? (e, els) => { if (els.length) opts.onClick(els[0].index); } : undefined,
          onHover: opts.onClick ? (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } : undefined
        }
      });
    });
    return wrap;
  }

  // Коли Chart.js довантажився або тема змінилась — перемальовуємо поточну сторінку
  document.addEventListener('crm:chartsready', () => { if (CRM.router && CRM.router.current) CRM.router.rerender(); });
  document.addEventListener('crm:chartsfailed', () => { if (CRM.router && CRM.router.current) CRM.router.rerender(); });
  // Кольори діаграм залежать від теми — перемальовуємо сторінку, якщо на ній є діаграми
  document.addEventListener('crm:themechange', () => { if (instances.size && CRM.router && CRM.router.current) CRM.router.rerender(); });

  CRM.charts = { available, failed, theme, placeholder, destroyAll, create, pie, line, bar, compact, seriesColor, alpha, applyDefaults, setQuiet };
})(window.CRM);
