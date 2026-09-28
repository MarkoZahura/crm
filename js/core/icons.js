/* ==========================================================================
   icons.js — вбудовані SVG-іконки (лінійні, 24×24, колір = колір тексту)
   Використання: CRM.icon('home') → <svg>
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const P = {
    home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>',
    tasks: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="m8 12.2 2.8 2.8L16 9.5"/>',
    wallet: '<path d="M17 7.5V5.8a1.8 1.8 0 0 0-2.3-1.7L5.2 6.8A2.3 2.3 0 0 0 3.5 9"/><rect x="3.5" y="7.5" width="17" height="12.5" rx="2.5"/><path d="M16 13.8h1.5"/>',
    dumbbell: '<path d="M6.5 7v10M17.5 7v10M4 9.5v5M20 9.5v5M6.5 12h11"/>',
    book: '<path d="M12 6.8C10.4 5.3 8 4.8 3.5 4.8v13.7c4.5 0 6.9.5 8.5 2 1.6-1.5 4-2 8.5-2V4.8c-4.5 0-6.9.5-8.5 2z"/><path d="M12 6.8v13.7"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h7.2a1.5 1.5 0 0 0 1.5-1.3L18 7"/><path d="M10 11v5.5M14 11v5.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M2.8 12h2M19.2 12h2M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
    moon: '<path d="M19.5 14.3A7.8 7.8 0 1 1 9.7 4.5a6.2 6.2 0 0 0 9.8 9.8z"/>',
    bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.8h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    restore: '<path d="M4 5v5h5"/><path d="M4.6 14.5A7.8 7.8 0 1 0 6.3 6.8L4 9.5"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
    upload: '<path d="M12 16V5"/><path d="m7.5 9.5 4.5-4.5 4.5 4.5"/><path d="M5 19.5h14"/>',
    sparkles: '<path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    alert: '<path d="M10.3 4.3 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.2v.1"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3"/>',
    chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    chevronLeft: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
    chevronDown: '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
    inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M3.5 13.5h5l1 2h5l1-2h5"/>',
    checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.3"/>',
    coins: '<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7"/><path d="M9.5 16.4c.9.9 2.9 1.6 5 1.6 3 0 5.5-1.1 5.5-2.5v-4c0-1.2-1.8-2.2-4.3-2.5"/>',
    repeat: '<path d="M17 3.5 20 6.5l-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12"/><path d="M7 20.5 4 17.5l3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.2"/>',
    tag: '<path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.3"/>',
    arrows: '<path d="M7 4.5v15M4 16.5l3 3 3-3"/><path d="M17 19.5v-15M14 7.5l3-3 3 3"/>',
    graduation: '<path d="m2.5 9.5 9.5-5 9.5 5-9.5 5z"/><path d="M6.5 11.7v4.3c1.5 1.6 3.4 2.4 5.5 2.4s4-.8 5.5-2.4v-4.3"/><path d="M21.5 9.5v5"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.9 1.4-1.9-.5-1.2.3-2.4 1.6-2.4h1.7a3.8 3.8 0 0 0 3.8-3.8C20.5 7.2 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11" r="1"/><circle cx="10.5" cy="7.3" r="1"/><circle cx="15" cy="7.8" r="1"/>',
    external: '<path d="M13.5 4.5h6v6"/><path d="M19.5 4.5 11 13"/><path d="M17.5 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 6 6.5h4.5"/>',
    shield: '<path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    receipt: '<path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    bank: '<path d="M3.5 9 12 4l8.5 5"/><path d="M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8"/><path d="M3.5 20h17"/>',
    paperclip: '<path d="M20 11.5 12.2 19.3a4.8 4.8 0 0 1-6.8-6.8l7.9-7.9a3.2 3.2 0 0 1 4.5 4.5l-7.9 7.9a1.6 1.6 0 0 1-2.3-2.3l7.3-7.3"/>',
    listChecks: '<path d="m3.5 6.5 1.5 1.5 3-3"/><path d="m3.5 13.5 1.5 1.5 3-3"/><path d="M11.5 7h9M11.5 14h9M11.5 19.5h9"/>',
    flag: '<path d="M5 21V4.5"/><path d="M5 4.5h11.5l-2 4 2 4H5"/>',
    file: '<path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6"/><path d="m20.5 15.5-4.8-4.8-9.2 8.8"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    quote: '<path d="M9.5 7H6a1.5 1.5 0 0 0-1.5 1.5V12A1.5 1.5 0 0 0 6 13.5h3.5V14c0 2-1.2 3.3-3.5 3.5"/><path d="M19.5 7H16a1.5 1.5 0 0 0-1.5 1.5V12a1.5 1.5 0 0 0 1.5 1.5h3.5V14c0 2-1.2 3.3-3.5 3.5"/>',
    trendUp: '<path d="m3.5 16.5 6-6 4 4 7-7"/><path d="M15 7.5h5.5V13"/>',
    trendDown: '<path d="m3.5 7.5 6 6 4-4 7 7"/><path d="M15 16.5h5.5V11"/>',
    scale: '<path d="M12 4v16M7.5 20h9M5 7.5h14"/><path d="m5 7.5-2.5 6a3 3 0 0 0 5 0z"/><path d="m19 7.5-2.5 6a3 3 0 0 0 5 0z"/>',
    sort: '<path d="M4 7h11M4 12h8M4 17h5"/><path d="M18 5v14M15.5 16.5 18 19l2.5-2.5"/>',
    archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.2"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
    pencil: '<path d="M4.5 19.5 5.5 15 15.8 4.7a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L9 18.5z"/><path d="m13.5 7 3.5 3.5"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1"/><path d="M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M17.5 3v4h-4"/><path d="M6.5 21v-4h4"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    piggy: '<path d="M18.5 10.5c.8.3 1.6 1 2 2l-.1 2.5h-1.6c-.5 1.2-1.4 2.2-2.6 2.8v2.2h-2.4v-1.5h-3.6v1.5H7.8v-2.3A6 6 0 0 1 5.5 9.5c1.3-2.7 4.2-3.8 7-3.8 2.6 0 4.3.9 5.3 2.2z"/><path d="M14.5 10.2h.1"/><path d="M4.5 9.5c-.8-.3-1.2-1-1-2"/>'
  };

  /**
   * Створити SVG-іконку.
   * @param {string} name — назва з набору вище
   * @param {object} [opts] — { size: 'sm' | 'lg', className }
   */
  CRM.icon = function (name, opts) {
    const o = opts || {};
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    let cls = 'icon';
    if (o.size === 'sm') cls += ' icon-sm';
    if (o.size === 'lg') cls += ' icon-lg';
    if (o.className) cls += ' ' + o.className;
    svg.setAttribute('class', cls);
    // Розмітка іконок — внутрішня й фіксована (не з даних користувача).
    svg.innerHTML = P[name] || P.info;
    return svg;
  };

  CRM.icon.names = Object.keys(P);
})(window.CRM);
