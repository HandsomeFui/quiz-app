(function () {
  'use strict';

  var LS_BANK = 'quiz.bank.v1';
  var LS_WRONG = 'quiz.wrong.v1';

  var DEFAULT_BANK = [
    { question: '1 + 1 = ?', options: ['1', '2', '3', '4'], answer: 'B' },
    { question: 'HTTP 默认端口是？', options: ['21', '80', '443', '8080'], answer: 'B' },
    { question: 'TCP 是面向连接的可靠传输协议。', type: 'judge', answer: '正确' }
  ];

  var bank = [];
  var wrongIds = new Set();
  var queue = [];
  var idx = 0;
  var selected = [];
  var submitted = false;
  var finished = false;
  var stats = { right: 0, wrong: 0 };
  var mode = 'all';

  /* ---------- 工具函数 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function isCorrect(q, sel) {
    if (!sel.length || !q.answer.length) return false;
    var a = sel.slice().sort(function (x, y) { return x - y; }).join(',');
    var b = q.answer.slice().sort(function (x, y) { return x - y; }).join(',');
    return a === b;
  }
  function parseAnswer(ans, options) {
    var arr = Array.isArray(ans) ? ans : (ans === undefined || ans === null ? [] : [ans]);
    var out = [];
    arr.forEach(function (a) {
      if (typeof a === 'number') { if (a >= 0) out.push(a); return; }
      var s = String(a).trim();
      var byText = options.indexOf(s);
      if (byText >= 0) { out.push(byText); return; }
      if (/^[A-Za-z]{1,6}$/.test(s)) {
        s.toUpperCase().split('').forEach(function (c) { out.push(c.charCodeAt(0) - 65); });
        return;
      }
      if (['正确', '对', '√', '是', 'T', 'true'].indexOf(s) >= 0) { out.push(0); return; }
      if (['错误', '错', '×', '否', 'F', 'false'].indexOf(s) >= 0) { out.push(1); return; }
      var n = Number(s);
      if (!isNaN(n) && n >= 0) out.push(n);
    });
    return out.filter(function (v, i) { return out.indexOf(v) === i; });
  }
  function normalizeBank(list) {
    var out = [];
    list.forEach(function (raw, i) {
      if (!raw || typeof raw !== 'object') return;
      var type = raw.type;
      var options = Array.isArray(raw.options) ? raw.options.map(String) : null;
      if (!options || !options.length) {
        if (!type || type === 'judge') { options = ['正确', '错误']; type = 'judge'; }
        else return;
      }
      if (!type) type = 'single';
      var question = raw.question || raw.title || raw.q || '';
      if (!question) return;
      var answer = parseAnswer(raw.answer, options);
      if (!answer.length) return;
      var bad = answer.some(function (a) { return a < 0 || a >= options.length; });
      if (bad) return;
      out.push({
        id: raw.id != null ? String(raw.id) : 'q' + (i + 1),
        type: type,
        question: String(question),
        options: options,
        answer: answer,
        explain: raw.explain || raw.analysis || raw.note || ''
      });
    });
    return out;
  }

  /* ---------- 存储 ---------- */
  function saveBank() {
    try { localStorage.setItem(LS_BANK, JSON.stringify(bank)); } catch (e) {}
  }
  function saveWrong() {
    try { localStorage.setItem(LS_WRONG, JSON.stringify(Array.from(wrongIds))); } catch (e) {}
  }
  async function loadAll() {
    var loaded = false;
    try {
      var resp = await fetch('./bank.json', { cache: 'no-cache' });
      if (resp.ok) {
        var data = await resp.json();
        if (!Array.isArray(data) && data && Array.isArray(data.questions)) data = data.questions;
        if (Array.isArray(data) && data.length) {
          bank = normalizeBank(data);
          if (bank.length) { saveBank(); loaded = true; }
        }
      }
    } catch (e) {}

    if (!loaded) {
      var raw = null;
      try { raw = JSON.parse(localStorage.getItem(LS_BANK)); } catch (e) {}
      if (!Array.isArray(raw) || !raw.length) raw = DEFAULT_BANK;
      bank = normalizeBank(raw);
      if (!bank.length) bank = normalizeBank(DEFAULT_BANK);
      saveBank();
    }

    try {
      var w = JSON.parse(localStorage.getItem(LS_WRONG));
      wrongIds = new Set(Array.isArray(w) ? w.map(String) : []);
    } catch (e) { wrongIds = new Set(); }
  }

  /* ---------- 渲染 ---------- */
  var card = document.getElementById('card');

  function updateHeader() {
    document.getElementById('stats').textContent = '本轮：对 ' + stats.right + ' · 错 ' + stats.wrong;
    document.getElementById('wrongCount').textContent =
      bank.filter(function (q) { return wrongIds.has(q.id); }).length;
    document.querySelectorAll('.toolbar button[data-mode]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
  }

  function render() {
    updateHeader();

    if (finished) {
      card.innerHTML = '<div class="done"><h2>🎉 本轮完成</h2>' +
        '<p>共 ' + queue.length + ' 题，答对 ' + stats.right + ' 题，答错 ' + stats.wrong + ' 题。</p></div>';
      var btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = '再来一轮';
      btn.onclick = function () { start(mode); };
      card.querySelector('.done').appendChild(btn);
      return;
    }

    if (!queue.length) {
      card.innerHTML = '<div class="empty">这里没有题目。<br>点「题库管理」导入题目，或换个练习模式试试。</div>';
      return;
    }

    var q = queue[idx];
    var typeName = { single: '单选题', multi: '多选题', judge: '判断题' }[q.type] || '题目';

    card.innerHTML =
      '<div class="qmeta">' +
        '<span class="tag">' + typeName + '</span>' +
        '<span>' + (idx + 1) + ' / ' + queue.length + '</span>' +
      '</div>' +
      '<div class="question">' + esc(q.question) + '</div>' +
      '<div class="options" id="options"></div>' +
      '<div class="explain hidden" id="explain"></div>' +
      '<div class="actions" id="actions"></div>';

    var optBox = document.getElementById('options');
    q.options.forEach(function (text, i) {
      var el = document.createElement('div');
      el.className = 'option';
      if (selected.indexOf(i) >= 0) el.classList.add('selected');
      if (submitted) {
        el.classList.add('locked');
        if (q.answer.indexOf(i) >= 0) el.classList.add('right');
        else if (selected.indexOf(i) >= 0) el.classList.add('wrong');
      }
      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = String.fromCharCode(65 + i);
      var txt = document.createElement('span');
      txt.className = 'text';
      txt.textContent = text;
      el.appendChild(label);
      el.appendChild(txt);
      el.onclick = function () { onOptionClick(i); };
      optBox.appendChild(el);
    });

    if (submitted) {
      var ex = document.getElementById('explain');
      ex.classList.remove('hidden');
      var ok = isCorrect(q, selected);
      var ansText = q.type === 'judge'
        ? q.answer.map(function (i) { return q.options[i]; }).join('、')
        : q.answer.map(function (i) { return String.fromCharCode(65 + i); }).join('、');
      ex.innerHTML =
        '<div class="verdict ' + (ok ? 'ok' : 'no') + '">' + (ok ? '✅ 回答正确' : '❌ 回答错误') + '</div>' +
        '<div class="ansline">正确答案：' + esc(ansText) + '</div>' +
        (q.explain ? '<div class="exptext">' + esc(q.explain) + '</div>' : '');
    }

    var actions = document.getElementById('actions');
    if (submitted) {
      var bn = document.createElement('button');
      bn.className = 'primary';
      bn.textContent = idx === queue.length - 1 ? '完成本轮' : '下一题';
      bn.onclick = nextQuestion;
      actions.appendChild(bn);
    } else {
      var bs = document.createElement('button');
      bs.className = 'primary';
      bs.textContent = '提交答案';
      bs.disabled = selected.length === 0;
      bs.onclick = submit;
      var bk = document.createElement('button');
      bk.textContent = '跳过';
      bk.onclick = nextQuestion;
      actions.appendChild(bs);
      actions.appendChild(bk);
    }
  }

  /* ---------- 交互 ---------- */
  function onOptionClick(i) {
    if (submitted) return;
    var q = queue[idx];
    if (q.type === 'multi') {
      var p = selected.indexOf(i);
      if (p >= 0) selected.splice(p, 1);
      else selected.push(i);
    } else {
      selected = [i];
    }
    render();
  }
  function submit() {
    if (submitted || !selected.length) return;
    var q = queue[idx];
    var ok = isCorrect(q, selected);
    submitted = true;
    if (ok) { stats.right++; wrongIds.delete(q.id); }
    else { stats.wrong++; wrongIds.add(q.id); }
    saveWrong();
    render();
  }
  function nextQuestion() {
    if (idx < queue.length - 1) {
      idx++; selected = []; submitted = false; render();
    } else { finished = true; render(); }
  }
  function start(m) {
    mode = m;
    finished = false; idx = 0; selected = []; submitted = false;
    stats = { right: 0, wrong: 0 };
    if (m === 'all') queue = bank.slice();
    else if (m === 'random') queue = shuffle(bank.slice());
    else if (m === 'wrong') queue = bank.filter(function (q) { return wrongIds.has(q.id); });
    render();
  }

  /* ---------- 题库管理弹窗 ---------- */
  var modal = document.getElementById('modal');
  var bankText = document.getElementById('bankText');
  var bankMsg = document.getElementById('bankMsg');

  function msg(text, isErr) {
    bankMsg.textContent = text;
    bankMsg.className = isErr ? 'err' : 'ok';
  }
  function openModal() {
    bankText.value = JSON.stringify(bank, null, 2);
    bankMsg.textContent = '';
    modal.classList.add('show');
  }

  document.getElementById('btnBank').onclick = openModal;
  document.getElementById('btnCloseModal').onclick = function () { modal.classList.remove('show'); };
  modal.onclick = function (e) { if (e.target === modal) modal.classList.remove('show'); };

  document.getElementById('fileInput').onchange = function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { bankText.value = r.result; msg('文件已读取，点「保存题库」生效', false); };
    r.readAsText(f, 'utf-8');
  };
  document.getElementById('btnSaveBank').onclick = function () {
    var txt = bankText.value.trim();
    if (!txt) { msg('内容为空', true); return; }
    var data;
    try { data = JSON.parse(txt); }
    catch (err) { msg('JSON 解析失败：' + err.message, true); return; }
    if (!Array.isArray(data)) {
      if (data && Array.isArray(data.questions)) data = data.questions;
      else if (data && Array.isArray(data.data)) data = data.data;
    }
    if (!Array.isArray(data)) { msg('题库必须是一个 JSON 数组', true); return; }
    var nb = normalizeBank(data);
    if (!nb.length) { msg('没有解析出有效题目', true); return; }
    bank = nb; saveBank();
    msg('已导入 ' + nb.length + ' 道题 ✓', false);
    start('all');
  };
  document.getElementById('btnExport').onclick = function () {
    var blob = new Blob([JSON.stringify(bank, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bank.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };
  document.getElementById('btnResetBank').onclick = function () {
    bank = normalizeBank(DEFAULT_BANK); saveBank();
    bankText.value = JSON.stringify(bank, null, 2);
    msg('已恢复示例题库', false);
    start('all');
  };
  document.getElementById('btnClearWrong').onclick = function () {
    wrongIds = new Set(); saveWrong(); updateHeader();
    msg('错题本已清空', false);
  };

  /* ---------- 启动 ---------- */
  document.querySelectorAll('.toolbar button[data-mode]').forEach(function (b) {
    b.onclick = function () { start(b.dataset.mode); };
  });

  loadAll().then(function () { start('all'); });

  /* ---------- 对外暴露接口（给 exam.js 用） ---------- */
  window.Quiz = {
    esc: esc,
    shuffle: shuffle,
    isCorrect: isCorrect,
    normalizeBank: normalizeBank,
    saveBank: saveBank,
    saveWrong: saveWrong,
    getBank: function () { return bank; },
    getWrongIds: function () { return wrongIds; },
    addWrong: function (id) { wrongIds.add(id); saveWrong(); },
    updateHeader: updateHeader,
    getCard: function () { return card; },
    getMode: function () { return mode; }
  };
})();