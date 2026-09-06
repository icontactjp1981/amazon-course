(function () {
  'use strict';

  const TOKEN_KEY = 'amazon_course_token';
  let DATA = null;          // getSiteData の結果
  let memToken = null;      // ストレージが使えない環境用

  // ---------- token storage ----------
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || memToken; }
    catch (e) { return memToken; }
  }
  function setToken(t) {
    memToken = t;
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {
      try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e2) {}
    }
  }
  function clearToken() {
    memToken = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // GAS の doPost を JSON API として呼ぶ。
  // Content-Type を付けない（text/plain 扱い）ことで CORS のプリフライトを回避する。
  async function api(action, payload) {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
      redirect: 'follow'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  function showChrome(on) {
    $('#topbar').hidden = !on;
    $('#footer').hidden = !on;
  }
  function setActiveNav(name) {
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  }
  function linksHtml(links) {
    const valid = (links || []).filter(l => l && l.url);
    if (!valid.length) return '';
    return '<ul class="links">' + valid.map(l =>
      `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a></li>`
    ).join('') + '</ul>';
  }
  function notesHtml(notes) {
    if (!notes || !notes.length) return '';
    return '<ul class="notes">' + notes.map(n => {
      const warn = String(n).trim().startsWith('※');
      return `<li class="${warn ? 'warn' : ''}">${esc(n)}</li>`;
    }).join('') + '</ul>';
  }

  // ---------- views ----------
  function renderLogin(message) {
    showChrome(false);
    app.classList.remove('wide');
    app.innerHTML = `
      <div class="login-wrap">
        <h1>${esc(SITE_NAME)}</h1>
        <p class="lead">受講生専用の学習サイトです。</p>
        <p class="error" id="login-error">${esc(message || '')}</p>
        <div class="field">
          <label for="email">メールアドレス</label>
          <input id="email" type="email" autocomplete="username" inputmode="email">
        </div>
        <div class="field">
          <label for="password">パスワード</label>
          <input id="password" type="password" autocomplete="current-password">
        </div>
        <button class="btn" id="btn-login" type="button">ログイン</button>
        <p class="login-help">ログインできない場合は、チャットワークで運営までご連絡ください。</p>
      </div>`;

    const submit = async () => {
      const btn = $('#btn-login');
      btn.disabled = true;
      btn.textContent = '確認中…';
      $('#login-error').textContent = '';
      try {
        const res = await api('login', { email: $('#email').value, password: $('#password').value });
        if (res.ok) {
          setToken(res.token);
          await loadData();
          navigate('home');
        } else {
          $('#login-error').textContent = res.message;
          btn.disabled = false;
          btn.textContent = 'ログイン';
        }
      } catch (e) {
        $('#login-error').textContent = '通信に失敗しました。時間をおいて再度お試しください。';
        btn.disabled = false;
        btn.textContent = 'ログイン';
      }
    };
    $('#btn-login').addEventListener('click', submit);
    ['#email', '#password'].forEach(sel => $(sel).addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
    $('#email').focus();
  }

  function opsHtml() {
    const ops = DATA.operations || { items: [] };
    const items = (ops.items || []).map(it => {
      const valid = (it.links || []).filter(l => l && l.url);
      const pending = (it.links || []).filter(l => l && !l.url).map(l => l.label);
      const sched = (it.schedule || []).filter(Boolean);
      return `
        <li>
          <h3>${esc(it.title)}</h3>
          ${it.body ? `<p>${esc(it.body)}</p>` : ''}
          ${sched.length ? `<ul class="schedule">${sched.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          ${linksHtml(valid)}
          ${pending.length ? `<p class="pending">${esc(pending.join('／'))}：準備中です。決まり次第ここに掲載します。</p>` : ''}
        </li>`;
    }).join('');
    return `
      <section class="ops" id="ops">
        ${ops.intro ? `<p class="lead">${esc(ops.intro)}</p>` : ''}
        <ul class="info-list">${items}</ul>
      </section>`;
  }

  function renderHome(opts) {
    setActiveNav((opts && opts.section) === 'ops' ? 'info' : 'home');
    const anns = DATA.announcements || [];
    const annHtml = anns.length
      ? '<ul class="ann-list">' + anns.map(a => `
          <li>
            <span class="ann-date">${esc(a.date)}</span><span class="ann-title">${esc(a.title)}</span>
            ${a.body ? `<p class="ann-body">${esc(a.body)}</p>` : ''}
          </li>`).join('') + '</ul>'
      : '';   // お知らせが無いときは見出しごと出さない

    const routeHtml = '<ol class="route">' + DATA.course.map((ch, i) => {
      const videos = ch.lessons.filter(l => l.video).length;
      const docs = ch.lessons.length - videos;
      const meta = [videos ? `動画 ${videos}本` : '', docs ? `資料・手順 ${docs}件` : ''].filter(Boolean).join('　');
      return `
        <li>
          <span class="num">${i + 1}</span>
          <a class="card" href="#chapter/${esc(ch.id)}">
            <div class="card-title">${esc(ch.title)}</div>
            <div class="card-meta">${esc(meta)}</div>
          </a>
        </li>`;
    }).join('') + '</ol>';

    app.innerHTML = `
      <p class="greeting">こんにちは、${esc(DATA.name)} さん</p>
      ${annHtml ? `<h1>お知らせ</h1>${annHtml}` : ''}
      <div class="home-grid">
        <section class="course" id="course">
          <h2>講座の進め方</h2>
          <p class="lead">上から順番に進めてください。準備編が終わっていない方は、まず準備編から。</p>
          ${routeHtml}
        </section>
        ${opsHtml()}
      </div>`;
    if (opts && opts.section) {
      const el = document.getElementById(opts.section);
      if (el) { el.scrollIntoView({ block: 'start' }); return; }
    }
    window.scrollTo(0, 0);
  }

  function renderChapter(id) {
    setActiveNav('home');
    const idx = DATA.course.findIndex(c => c.id === id);
    if (idx < 0) { navigate('home'); return; }
    const ch = DATA.course[idx];
    const prev = DATA.course[idx - 1];
    const next = DATA.course[idx + 1];

    const list = '<ol class="lesson-list">' + ch.lessons.map((l, i) => `
      <li>
        <a href="#lesson/${esc(ch.id)}/${i}">
          <span class="idx">${i + 1}</span>
          <span class="l-title">${esc(l.title)}</span>
          <span class="tag ${l.video ? 'video' : ''}">${l.video ? '動画' : '資料'}</span>
        </a>
      </li>`).join('') + '</ol>';

    app.innerHTML = `
      <div class="crumb"><a href="#home">ホーム</a> ›</div>
      <h1>${idx + 1}. ${esc(ch.title)}</h1>
      ${ch.lead ? `<p class="lead">${esc(ch.lead)}</p>` : ''}
      ${list}
      <nav class="pager">
        ${prev ? `<a href="#chapter/${esc(prev.id)}"><span class="dir">前の章</span>${esc(prev.title)}</a>` : ''}
        ${next ? `<a class="next" href="#chapter/${esc(next.id)}"><span class="dir">次の章</span>${esc(next.title)}</a>` : ''}
      </nav>`;
    window.scrollTo(0, 0);
  }

  function renderLesson(chId, n) {
    setActiveNav('home');
    const cIdx = DATA.course.findIndex(c => c.id === chId);
    if (cIdx < 0) { navigate('home'); return; }
    const ch = DATA.course[cIdx];
    const i = Number(n);
    const l = ch.lessons[i];
    if (!l) { navigate('chapter/' + chId); return; }

    // 前後のレッスン（章をまたぐ）
    let prevHref = null, prevTitle = '', nextHref = null, nextTitle = '';
    if (i > 0) { prevHref = `#lesson/${ch.id}/${i - 1}`; prevTitle = ch.lessons[i - 1].title; }
    else if (DATA.course[cIdx - 1]) {
      const pc = DATA.course[cIdx - 1];
      prevHref = `#lesson/${pc.id}/${pc.lessons.length - 1}`; prevTitle = pc.lessons[pc.lessons.length - 1].title;
    }
    if (i < ch.lessons.length - 1) { nextHref = `#lesson/${ch.id}/${i + 1}`; nextTitle = ch.lessons[i + 1].title; }
    else if (DATA.course[cIdx + 1]) {
      const nc = DATA.course[cIdx + 1];
      nextHref = `#lesson/${nc.id}/0`; nextTitle = nc.lessons[0].title;
    }

    const video = l.video
      ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(l.video)}?rel=0" title="${esc(l.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`
      : '';

    app.innerHTML = `
      <div class="crumb"><a href="#home">ホーム</a> › <a href="#chapter/${esc(ch.id)}">${esc(ch.title)}</a> ›</div>
      <h1>${esc(l.title)}</h1>
      ${video}
      ${notesHtml(l.notes)}
      ${linksHtml(l.links)}
      <nav class="pager">
        ${prevHref ? `<a href="${prevHref}"><span class="dir">前へ</span>${esc(prevTitle)}</a>` : ''}
        ${nextHref ? `<a class="next" href="${nextHref}"><span class="dir">次へ</span>${esc(nextTitle)}</a>` : ''}
      </nav>`;
    window.scrollTo(0, 0);
  }

  // ---------- data & routing ----------
  async function loadData() {
    const res = await api('getSiteData', { token: getToken() });
    if (!res.ok) { clearToken(); DATA = null; throw new Error(res.message || 'unauthorized'); }
    DATA = res;
    showChrome(true);
  }

  // 通常のハッシュルーティング（URL の #chapter/... が画面の状態。戻る／進む・ブックマーク対応）
  let currentHash = '';

  function normalizeHash(h) {
    return String(h || '').replace(/^#/, '');
  }

  function navigate(hash) {
    const h = normalizeHash(hash);
    if (h === normalizeHash(location.hash)) { route(h); return; }   // 同じ場所なら再描画のみ
    location.hash = '#' + h;                                          // hashchange → route()
  }

  // 同じハッシュを再クリックしたときも反応させる（例：運営情報ボタン）
  document.addEventListener('click', (e) => {
    const a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });

  function route(hash) {
    if (!DATA) { renderLogin(); return; }
    currentHash = normalizeHash(hash != null ? hash : location.hash);
    const parts = (currentHash || 'home').split('/');
    app.classList.toggle('wide', parts[0] !== 'chapter' && parts[0] !== 'lesson');
    switch (parts[0]) {
      case 'chapter': renderChapter(parts[1]); break;
      case 'lesson': renderLesson(parts[1], parts[2] || 0); break;
      case 'info': renderHome({ section: 'ops' }); break;
      default: renderHome();
    }
  }

  async function init() {
    window.addEventListener('hashchange', () => route(location.hash));

    $('#btn-logout').addEventListener('click', async () => {
      const t = getToken();
      clearToken();
      DATA = null;
      try { await api('logout', { token: t }); } catch (e) {}
      currentHash = '';
      history.replaceState(null, '', location.pathname + location.search);
      renderLogin();
    });

    if (!getToken()) { renderLogin(); return; }
    try {
      await loadData();
      route(location.hash);
    } catch (e) {
      renderLogin();
    }
  }

  init();
})();
