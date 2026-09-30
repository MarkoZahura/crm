/* ==========================================================================
   profile.js — «Мій кабінет»: ім'я, пошта, телефон, тема й колір інтерфейсу,
   службовий блок (сповіщення, Google Календар — див. gcal.js, експорт /
   імпорт, демо-дані, очищення даних).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };

  // ---------- Профіль ----------
  function profileCard() {
    const profile = Object.assign({ name: '', email: '', phone: '' }, CRM.store.getSetting('profile', {}));

    const nameIn = ui.input({ name: 'name', value: profile.name, maxlength: 60, placeholder: 'Напр., Марія Коваленко', autocomplete: 'name' });
    const emailIn = ui.input({ name: 'email', type: 'email', value: profile.email, placeholder: 'name@example.com', autocomplete: 'email' });
    const phoneIn = ui.input({ name: 'phone', type: 'tel', value: profile.phone, placeholder: '+380 67 123 45 67', autocomplete: 'tel' });

    const fName = ui.field({ label: 'Імʼя', input: nameIn, className: 'span-2', hint: 'З нього беруться ініціали для аватара.' });
    const fEmail = ui.field({ label: 'Пошта', input: emailIn });
    const fPhone = ui.field({ label: 'Телефон', input: phoneIn });

    const avatar = h('span', { class: 'avatar avatar-lg' });
    const heroName = h('div', { class: 'profile-hero-name' });
    const heroSub = h('div', { class: 'profile-hero-sub' });

    function updateHero() {
      const name = nameIn.value.trim();
      const ini = CRM.utils.initials(name);
      avatar.classList.toggle('is-empty', !ini);
      if (ini) avatar.textContent = ini; else avatar.replaceChildren(CRM.icon('user', { size: 'lg' }));
      heroName.textContent = name || 'Без імені';
      heroSub.textContent = [emailIn.value.trim(), phoneIn.value.trim()].filter(Boolean).join(' · ') || 'Пошта й телефон не вказані';
    }
    updateHero();

    const saveBtn = ui.button({ label: 'Зберегти', variant: 'primary', type: 'submit', disabled: true });

    function isDirty() {
      const cur = Object.assign({ name: '', email: '', phone: '' }, CRM.store.getSetting('profile', {}));
      return nameIn.value.trim() !== cur.name || emailIn.value.trim() !== cur.email || phoneIn.value.trim() !== cur.phone;
    }

    const form = h('form', { novalidate: true },
      h('div', { class: 'profile-hero' }, avatar, h('div', null, heroName, heroSub)),
      h('div', { class: 'form-grid' }, fName, fEmail, fPhone),
      h('div', { class: 'btn-row', style: { marginTop: '18px', justifyContent: 'space-between' } },
        h('span', { class: 'field-hint' }, 'Зберігається лише в цьому браузері.'),
        saveBtn));

    form.addEventListener('input', () => { updateHero(); saveBtn.disabled = !isDirty(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameIn.value.trim();
      const email = emailIn.value.trim();
      const phone = phoneIn.value.trim();
      let ok = true;
      if (email && !CRM.utils.isValidEmail(email)) { fEmail.setError('Перевір адресу — напр., name@example.com'); ok = false; }
      if (phone && !CRM.utils.isValidPhone(phone)) { fPhone.setError('Вкажи номер з кодом: 10–15 цифр, напр., +380 67 123 45 67'); ok = false; }
      if (!ok) return;
      await CRM.store.setSetting('profile', { name, email, phone });
      saveBtn.disabled = true;
      ui.toast('Профіль збережено', { type: 'success' });
    });

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Профіль')),
      h('div', { class: 'card-body' }, form));
  }

  // ---------- Вигляд: тема й акцентний колір ----------
  function appearanceCard() {
    const themeOptions = [
      { id: 'light', label: 'Світла', icon: 'sun' },
      { id: 'dark', label: 'Темна', icon: 'moon' },
      { id: 'system', label: 'Як у системі', icon: 'palette' }
    ];
    const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Тема' });
    function renderSeg() {
      const pref = CRM.theme.pref();
      ui.mount(seg, themeOptions.map((o) => h('button', {
        type: 'button', role: 'radio', class: pref === o.id ? 'active' : '',
        'aria-checked': pref === o.id ? 'true' : 'false',
        onClick: async () => { await CRM.theme.set(o.id); renderSeg(); }
      }, CRM.icon(o.icon, { size: 'sm' }), o.label)));
    }
    renderSeg();

    const caption = h('div', { class: 'accent-caption' });
    const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Колір інтерфейсу' });
    function renderSwatches() {
      const cur = CRM.theme.accent();
      ui.mount(swatches, CRM.dict.accents.map((a) => h('button', {
        type: 'button', role: 'radio', class: 'swatch' + (a.id === cur ? ' active' : ''),
        style: { '--sw': a.color }, title: a.name, 'aria-label': a.name,
        'aria-checked': a.id === cur ? 'true' : 'false',
        onClick: async () => { await CRM.theme.setAccent(a.id); renderSwatches(); }
      }, a.id === cur ? CRM.icon('check') : null)));
      const acc = CRM.dict.get('accents', cur);
      caption.textContent = `${acc ? acc.name : ''} — застосовується одразу в обох темах.`;
    }
    renderSwatches();

    const card = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Вигляд')),
      h('div', { class: 'card-body stack' },
        h('div', { class: 'appearance-row' }, h('div', { class: 'setting-title' }, 'Тема'), seg),
        h('div', null, h('div', { class: 'setting-title', style: { marginBottom: '12px' } }, 'Колір інтерфейсу'), swatches, caption)));
    card._refresh = () => { renderSeg(); renderSwatches(); };
    return card;
  }

  // ---------- Службове: сповіщення й календар ----------
  function servicesCard() {
    const notifRow = h('div', { class: 'setting-row' });
    function renderNotif() {
      const p = CRM.notify.permission();
      const desc = {
        granted: 'Дозволено. Нагадування показуються й тоді, коли вкладка у фоні.',
        default: 'Не увімкнено. Нагадування видно лише в дзвіночку.',
        denied: 'Заблоковано в браузері. Дозволь у налаштуваннях сайту (значок ліворуч від адреси).',
        unsupported: 'Цей браузер не підтримує системні сповіщення.'
      }[p];
      ui.mount(notifRow,
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('bell', { size: 'sm' }), 'Системні сповіщення',
            p === 'granted' ? h('span', { class: 'badge badge-success' }, 'увімкнено') : null),
          h('div', { class: 'setting-desc' }, desc),
          h('div', { class: 'setting-desc subtle' }, 'Без сервера нагадування приходять лише тоді, коли сайт відкритий.')),
        h('div', { class: 'setting-actions' },
          p === 'default' ? ui.button({ label: 'Увімкнути', variant: 'primary', size: 'sm', onClick: async () => { await CRM.notify.requestPermission(); renderNotif(); } }) : null,
          ui.button({ label: 'Тестове сповіщення', size: 'sm', onClick: () => CRM.notify.test() })));
    }
    renderNotif();

    const syncBlock = moduleBlock('sync');
    const gcalBlock = moduleBlock('gcal');

    const card = h('section', { class: 'card' }, notifRow, syncBlock, gcalBlock);
    card._refresh = renderNotif;
    card._destroy = () => { [syncBlock, gcalBlock].forEach((b) => { if (b && b._destroy) b._destroy(); }); };
    return card;
  }

  // ---------- Дані: експорт, імпорт, демо ----------
  async function doExport(btn) {
    btn.disabled = true;
    try {
      const data = await CRM.store.exportAll();
      const json = JSON.stringify(data, null, 1);
      const name = `crm-backup-${CRM.date.today()}.json`;
      CRM.utils.downloadBlob(new Blob([json], { type: 'application/json' }), name);
      await CRM.store.setSetting('lastExport', new Date().toISOString());
      ui.toast(`Резервну копію збережено: ${name}`, { type: 'success' });
    } catch (e) {
      console.error(e);
      ui.toast('Не вдалося зробити експорт: ' + e.message, { type: 'error' });
    } finally {
      btn.disabled = false;
    }
  }

  function summaryNode(obj) {
    const s = CRM.store.summarize(obj);
    const rows = [
      ['Задачі', s.tasks], ['Рахунки', s.accounts], ['Транзакції', s.transactions], ['Категорії', s.categories],
      ['Регулярні платежі', s.recurring], ['Фінансові цілі', s.goals], ['Тренування', s.workouts],
      ['Навчання', s.courses], ['Харчування', s.meals], ['Продукти', s.foods], ['Вкладення', s.attachments]
    ].filter((r) => r[1] > 0);
    return h('div', { class: 'stack', style: { gap: '12px' } },
      h('p', { class: 'modal-text' }, obj.exportedAt ? `Копія від ${CRM.fmt.dateTime(obj.exportedAt)}.` : 'Резервна копія.'),
      rows.length
        ? h('div', { class: 'chips' }, rows.map(([l, n]) => h('span', { class: 'badge' }, `${l}: ${n}`)))
        : h('p', { class: 'modal-text' }, 'У файлі немає записів.'),
      obj.withoutAttachments ? h('p', { class: 'modal-text' }, 'Це копія без вкладених файлів: вкладення, які вже є на цьому пристрої, залишаться.') : null,
      h('div', { class: 'callout callout-warning' }, CRM.icon('alert'),
        h('span', null, h('strong', null, 'Усі поточні дані буде замінено'), ' вмістом файлу.')));
  }

  async function doImport(file, input) {
    try {
      if (!file) return;
      let obj;
      try {
        obj = JSON.parse(await CRM.utils.readFileAsText(file));
      } catch (e) {
        throw new Error('Файл пошкоджений або це не JSON.');
      }
      CRM.store.validateDump(obj);
      const ok = await ui.confirm({ title: 'Імпортувати дані?', message: summaryNode(obj), confirmText: 'Імпортувати' });
      if (!ok) return;
      await CRM.store.importAll(obj);
      await CRM.app.ensureDefaults();
      CRM.theme.apply();
      CRM.theme.sync();
      ui.toast('Дані імпортовано', { type: 'success' });
    } catch (e) {
      ui.toast(e.message || 'Не вдалося імпортувати файл', { type: 'error', duration: 7000 });
    } finally {
      input.value = '';
    }
  }

  async function doDemo() {
    const ok = await ui.confirm({
      title: 'Заповнити демо-даними?',
      message: h('div', { class: 'stack', style: { gap: '12px' } },
        h('p', { class: 'modal-text' }, 'Зʼявляться приклади задач, рахунків, транзакцій за 12 місяців, регулярних платежів, цілей, тренувань і навчання — щоб перевірити діаграми й пошук.'),
        h('div', { class: 'callout callout-warning' }, CRM.icon('alert'),
          h('span', null, h('strong', null, 'Поточні дані буде замінено.'), ' Якщо вони потрібні — спершу зроби експорт. Профіль, тема й колір не зміняться.'))),
      confirmText: 'Заповнити'
    });
    if (!ok) return;
    try {
      await CRM.store.replaceAll(CRM.demo.generate());
      ui.toast('Демо-дані додано', { type: 'success', action: { label: 'На Головну', onClick: () => CRM.router.go('home') } });
    } catch (e) {
      console.error(e);
      ui.toast('Не вдалося створити демо-дані: ' + e.message, { type: 'error' });
    }
  }

  async function doClear() {
    const ok = await ui.confirm({
      title: 'Очистити всі дані?',
      message: h('div', { class: 'stack', style: { gap: '12px' } },
        h('p', { class: 'modal-text' }, 'Буде видалено всі задачі, рахунки, транзакції, платежі, цілі, тренування, навчання, вкладення, сповіщення, Кошик і профіль. Залишаться тільки тема, колір інтерфейсу та стартовий набір категорій.'),
        h('div', { class: 'callout callout-warning' }, CRM.icon('alert'),
          h('span', null, h('strong', null, 'Це не можна скасувати.'), ' Спершу зроби експорт, якщо дані можуть знадобитися.'))),
      confirmText: 'Видалити все',
      danger: true
    });
    if (!ok) return;
    await CRM.store.clearAll();
    await CRM.app.ensureDefaults();
    ui.toast('Усі дані видалено');
  }

  function dataCard(backupBlock) {
    const exportBtn = ui.button({ label: 'Експортувати', icon: 'download', size: 'sm' });
    exportBtn.addEventListener('click', () => doExport(exportBtn));

    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', tabIndex: -1, 'aria-hidden': 'true' });
    fileInput.addEventListener('change', () => doImport(fileInput.files[0], fileInput));
    const importBtn = ui.button({ label: 'Імпортувати', icon: 'upload', size: 'sm', onClick: () => fileInput.click() });

    const lastExport = CRM.store.getSetting('lastExport', null);
    const storageLine = h('div', { class: 'storage-line' }, 'Рахую зайняте місце…');
    Promise.all([CRM.store.storageEstimate(), navigator.storage && navigator.storage.persisted ? navigator.storage.persisted().catch(() => false) : Promise.resolve(false)])
      .then(([est, persisted]) => {
        const used = est && typeof est.usage === 'number' ? 'Зайнято приблизно ' + CRM.fmt.bytes(est.usage) + '. ' : '';
        storageLine.textContent = used + (persisted
          ? 'Браузер не видалятиме ці дані автоматично.'
          : 'Браузер може очистити дані сайту при нестачі місця — роби експорт час від часу.');
      });

    return h('section', { class: 'card' },
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('download', { size: 'sm' }), 'Резервна копія'),
          h('div', { class: 'setting-desc' }, 'Усі записи й вкладення в одному JSON-файлі.' +
            (lastExport ? ` Остання: ${CRM.fmt.dateTime(lastExport)}.` : ' Ще не робилася.'))),
        h('div', { class: 'setting-actions' }, exportBtn)),
      backupBlock || null,
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('upload', { size: 'sm' }), 'Відновлення з копії'),
          h('div', { class: 'setting-desc' }, 'Замінює всі поточні дані вмістом файлу. Так само переносяться дані між браузерами чи компʼютерами.')),
        h('div', { class: 'setting-actions' }, importBtn, fileInput)),
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('sparkles', { size: 'sm' }), 'Демо-дані'),
          h('div', { class: 'setting-desc' }, 'Приклади за 12 місяців, щоб перевірити діаграми. Замінюють поточні дані.')),
        h('div', { class: 'setting-actions' }, ui.button({ label: 'Заповнити демо-даними', size: 'sm', onClick: doDemo }))),
      storageLine);
  }

  function dangerCard() {
    return h('section', { class: 'card danger-card' },
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, 'Очистити всі дані'),
          h('div', { class: 'setting-desc' }, 'Видаляє всі записи в цьому браузері. Тема й колір інтерфейсу залишаться.')),
        h('div', { class: 'setting-actions' }, ui.button({ label: 'Очистити всі дані', variant: 'danger', size: 'sm', onClick: doClear }))));
  }

  /** Блок службового модуля (синхронізація, календар, копії); якщо модуль не завантажено — без нього. */
  function moduleBlock(name) {
    try { return CRM[name] && CRM[name].settingsBlock ? CRM[name].settingsBlock() : null; } catch (e) { console.error(e); return null; }
  }

  // ---------- Сторінка ----------
  function render(container, route) {
    const appearance = appearanceCard();
    const services = servicesCard();
    const backupBlock = moduleBlock('backup');
    ui.mount(container,
      ui.pageHead({ title: 'Мій кабінет', sub: 'Профіль, вигляд і службові налаштування.' }),
      h('div', { class: 'profile-grid' },
        profileCard(),
        appearance,
        h('div', { class: 'section-title' }, 'Службове'),
        services,
        dataCard(backupBlock),
        dangerCard()));

    const onTheme = () => appearance._refresh();
    const onPerm = () => services._refresh();
    document.addEventListener('crm:themechange', onTheme);
    document.addEventListener('crm:notifpermission', onPerm);
    const focus = route && route.params && route.params.focus;
    if (focus === 'gcal' || focus === 'backup' || focus === 'sync') {
      CRM.router.consumeParam('focus');
      requestAnimationFrame(() => {
        const el = document.getElementById(focus);
        if (el) el.scrollIntoView({ block: 'center' });
      });
    }
    return () => {
      document.removeEventListener('crm:themechange', onTheme);
      document.removeEventListener('crm:notifpermission', onPerm);
      if (services._destroy) services._destroy();
      if (backupBlock && backupBlock._destroy) backupBlock._destroy();
    };
  }

  // Сторінка не перемальовується від змін налаштувань, щоб не стерти незбережений ввід
  CRM.router.register('profile', { title: 'Мій кабінет', stores: [], render });

  CRM.profile = { doExport, doImport, doDemo, doClear };
})(window.CRM);
