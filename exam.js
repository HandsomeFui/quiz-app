(function () {
  'use strict';
  if (!window.Quiz) {
    console.error('[exam.js] 未找到 window.Quiz，请确认 app.js 已加载且暴露了 Quiz');
    return;
  }

  var Q = window.Quiz;
  var card = Q.getCard();
  var LS_HISTORY = 'quiz.exam.history.v1';

  /* ---------- 本地工具 ---------- */
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

  /* ---------- 准备题目：随机打乱选项顺序 ---------- */
  function prepareQuestion(q, randomize) {
    var prepared = {
      id: q.id, type: q.type, question: q.question,
      options: q.options.slice(),
      answer: q.answer.slice(),
      explain: q.explain || '',
      originalOptions: q.options.slice(),
      originalAnswer: q.answer.slice(),
      shuffled: false
    };
    if (randomize && q.type !== 'judge' && q.options.length > 1) {
      var n = q.options.length;
      var order = [];
      for (var i = 0; i < n; i++) order.push(i);
      shuffle(order);
      prepared.options = order.map(function (i) { return q.options[i]; });
      prepared.answer = [];
      for (var j = 0; j < n; j++) {
        if (q.answer.indexOf(order[j]) >= 0) prepared.answer.push(j);
      }
      prepared.shuffled = true;
    }
    return prepared;
  }

  /* ---------- 历史记录 ---------- */
  function loadHistory() {
    try {
      var h = JSON.parse(localStorage.getItem(LS_HISTORY));
      return Array.isArray(h) ? h : [];
    } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(list.slice(0, 50))); } catch (e) {}
  }
  function addHistory(record) {
    var list = loadHistory();
    list.unshift(record);
    saveHistory(list);
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function formatTime(s) {
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return pad(m) + ':' + pad(sec);
  }

  /* ---------- DOM ---------- */
  var setupModal   = document.getElementById('examSetupModal');
  var resultModal  = document.getElementById('examResultModal');
  var resultBody   = document.getElementById('examResultBody');
  var historyModal = document.getElementById('examHistoryModal');
  var historyBody  = document.getElementById('examHistoryBody');
  var countSel     = document.getElementById('examCount');
  var timeSel      = document.getElementById('examTime');
  var randomSel    = document.getElementById('examRandom');

  var state = null;
  var timerId = null;
  var navEl = null;
  var pauseEl = null;

  /* ---------- 打开设置 ---------- */
  document.getElementById('btnExam').onclick = function () {
    if (!Q.getBank().length) { alert('题库为空，请先导入题库'); return; }
    setupModal.classList.add('show');
  };
  document.getElementById('btnCloseExamSetup').onclick = function () { setupModal.classList.remove('show'); };
  setupModal.onclick = function (e) { if (e.target === setupModal) setupModal.classList.remove('show'); };

  /* ---------- 开始考试 ---------- */
  document.getElementById('btnStartExam').onclick = function () {
    var bank = Q.getBank();
    var countVal = countSel.value;
    var timeVal = parseInt(timeSel.value, 10);
    var randomize = randomSel && randomSel.checked;

    var list = shuffle(bank.slice());
    if (countVal !== 'all') list = list.slice(0, parseInt(countVal, 10));
    if (!list.length) { alert('题库为空'); return; }

    var prepared = list.map(function (q) { return prepareQuestion(q, randomize); });

    state = {
      questions: prepared,
      answers: prepared.map(function () { return []; }),
      current: 0,
      total: prepared.length,
      totalTime: timeVal * 60,
      timeLeft: timeVal * 60,
      paused: false,
      submitted: false,
      startedAt: Date.now()
    };

    setupModal.classList.remove('show');
    if (timerId) { clearInterval(timerId); timerId = null; }
    if (timeVal > 0) timerId = setInterval(tick, 1000);

    renderExam();
  };

  function tick() {
    if (!state || state.submitted || state.paused) return;
    state.timeLeft--;
    updateTimer();
    if (state.timeLeft <= 0) {
      clearInterval(timerId); timerId = null;
      finishExam(true);
    }
  }

  function updateTimer() {
    var el = document.getElementById('examTimer');
    if (!el || !state) return;
    if (state.totalTime === 0) { el.textContent = '不限时'; return; }
    var t = state.timeLeft;
    el.textContent = formatTime(t);
    el.classList.toggle('warning', t <= 60);
  }

  /* ---------- 渲染考试 ---------- */
  function renderExam() {
    if (!state || state.submitted) return;
    var q = state.questions[state.current];
    var ans = state.answers[state.current];
    var typeName = { single: '单选题', multi: '多选题', judge: '判断题' }[q.type] || '题目';
    var answered = state.answers.filter(function (a) { return a.length; }).length;

    card.innerHTML =
      '<div class="exam-header">' +
        '<span class="exam-progress">第 ' + (state.current + 1) + ' / ' + state.total + ' 题</span>' +
        '<span class="exam-timer" id="examTimer">--:--</span>' +
        '<button class="exam-nav-btn" id="btnExamPause">暂停</button>' +
        '<button class="exam-nav-btn" id="btnExamNav">题目导航</button>' +
      '</div>' +
      '<div class="qmeta">' +
        '<span class="tag exam">' + typeName + '</span>' +
        '<span>已答 ' + answered + ' / ' + state.total + '</span>' +
      '</div>' +
      '<div class="question">' + esc(q.question) + '</div>' +
      '<div class="options" id="options"></div>' +
      '<div class="actions">' +
        '<button id="btnPrev" ' + (state.current === 0 ? 'disabled' : '') + '>上一题</button>' +
        '<button id="btnNext" ' + (state.current === state.total - 1 ? 'disabled' : '') + '>下一题</button>' +
        '<button class="primary" id="btnSubmitExam">交卷</button>' +
      '</div>';

    var optBox = document.getElementById('options');
    q.options.forEach(function (text, i) {
      var el = document.createElement('div');
      el.className = 'option';
      if (ans.indexOf(i) >= 0) el.classList.add('selected');
      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = String.fromCharCode(65 + i);
      var txt = document.createElement('span');
      txt.className = 'text';
      txt.textContent = text;
      el.appendChild(label);
      el.appendChild(txt);
      el.onclick = function () { onExamOptionClick(i); };
      optBox.appendChild(el);
    });

    document.getElementById('btnPrev').onclick = function () {
      if (state.current > 0) { state.current--; renderExam(); }
    };
    document.getElementById('btnNext').onclick = function () {
      if (state.current < state.total - 1) { state.current++; renderExam(); }
    };
    document.getElementById('btnSubmitExam').onclick = function () {
      var unanswered = state.answers.filter(function (a) { return !a.length; }).length;
      var tip = '确定交卷吗？';
      if (unanswered) tip += '\n还有 ' + unanswered + ' 题未作答。';
      if (confirm(tip)) finishExam(false);
    };
    document.getElementById('btnExamNav').onclick = openNav;
    document.getElementById('btnExamPause').onclick = pauseExam;

    updateTimer();
  }

  function onExamOptionClick(i) {
    if (!state || state.submitted || state.paused) return;
    var q = state.questions[state.current];
    var ans = state.answers[state.current];
    if (q.type === 'multi') {
      var p = ans.indexOf(i);
      if (p >= 0) ans.splice(p, 1); else ans.push(i);
    } else {
      state.answers[state.current] = [i];
    }
    renderExam();
  }

  /* ---------- 暂停 / 继续 ---------- */
  function pauseExam() {
    if (!state || state.submitted || state.paused) return;
    state.paused = true;
    if (pauseEl) pauseEl.remove();
    pauseEl = document.createElement('div');
    pauseEl.className = 'pause-overlay';
    pauseEl.innerHTML =
      '<div class="pause-box">' +
        '<h2>⏸ 已暂停</h2>' +
        '<p>计时已停止，点击下方按钮继续。</p>' +
        '<button class="primary" id="btnResumeExam">继续考试</button>' +
      '</div>';
    document.body.appendChild(pauseEl);
    document.getElementById('btnResumeExam').onclick = resumeExam;
  }
  function resumeExam() {
    if (!state) return;
    state.paused = false;
    if (pauseEl) { pauseEl.remove(); pauseEl = null; }
    renderExam();
  }

  /* ---------- 题目导航 ---------- */
  function openNav() {
    if (navEl) navEl.remove();
    navEl = document.createElement('div');
    navEl.className = 'modal show';
    navEl.innerHTML =
      '<div class="modal-box">' +
        '<h2>题目导航</h2>' +
        '<p>点击题号可跳转。蓝色为已答，灰色为未答，深色为当前题。</p>' +
        '<div class="nav-grid" id="navGrid"></div>' +
        '<div class="modal-actions"><button id="btnCloseNav">关闭</button></div>' +
      '</div>';
    document.body.appendChild(navEl);

    var grid = document.getElementById('navGrid');
    state.questions.forEach(function (_, i) {
      var el = document.createElement('div');
      el.className = 'nav-item';
      if (i === state.current) el.classList.add('current');
      else if (state.answers[i].length) el.classList.add('answered');
      el.textContent = i + 1;
      el.onclick = function () {
        state.current = i;
        closeNav();
        renderExam();
      };
      grid.appendChild(el);
    });
    document.getElementById('btnCloseNav').onclick = closeNav;
    navEl.onclick = function (e) { if (e.target === navEl) closeNav(); };
  }
  function closeNav() { if (navEl) { navEl.remove(); navEl = null; } }

  /* ---------- 交卷 ---------- */
  function finishExam(isTimeout) {
    if (!state || state.submitted) return;
    state.submitted = true;
    if (timerId) { clearInterval(timerId); timerId = null; }
    if (pauseEl) { pauseEl.remove(); pauseEl = null; }

    var right = 0, wrong = 0, unanswered = 0;
    var wrongList = [];
    state.questions.forEach(function (q, i) {
      var ans = state.answers[i];
      if (!ans.length) {
        unanswered++;
        wrongList.push({ q: q, sel: [] });
        return;
      }
      if (isCorrect(q, ans)) right++;
      else { wrong++; wrongList.push({ q: q, sel: ans }); }
    });

    wrongList.forEach(function (item) { Q.addWrong(item.q.id); });
    Q.updateHeader();

    var score = Math.round(right / state.total * 100);
    var usedTime = state.totalTime > 0
      ? (state.totalTime - state.timeLeft)
      : Math.round((Date.now() - state.startedAt) / 1000);

    addHistory({
      time: Date.now(),
      total: state.total,
      right: right,
      wrong: wrong,
      unanswered: unanswered,
      score: score,
      usedTime: usedTime,
      timeout: !!isTimeout
    });

    var html =
      (isTimeout ? '<div style="text-align:center;color:#dc2626;font-weight:600;margin-bottom:8px">⏰ 时间到，已自动交卷</div>' : '') +
      '<div class="result-score ' + (score >= 60 ? 'pass' : 'fail') + '">' + score + ' 分</div>' +
      '<div class="result-detail">共 ' + state.total + ' 题 · 正确 ' + right + ' · 错误 ' + wrong +
        (unanswered ? ' · 未答 ' + unanswered : '') +
        ' · 用时 ' + formatTime(usedTime) + '</div>';

    if (wrongList.length) {
      html += '<div class="result-wrong-list"><h3>错题回顾（共 ' + wrongList.length + ' 题）</h3>';
      wrongList.forEach(function (item, idx) {
        html += renderWrongItem(item, idx + 1);
      });
      html += '</div>';
    } else {
      html += '<div class="result-detail" style="color:#16a34a">🎉 全部正确，太棒了！</div>';
    }

    resultBody.innerHTML = html;
    resultModal.classList.add('show');
  }

  /* ---------- 详细错题回顾 ---------- */
  function renderWrongItem(item, num) {
    var q = item.q;
    var sel = item.sel;
    var html = '<div class="result-wrong-item">';
    html += '<div class="q">' + num + '. ' + esc(q.question) + '</div>';
    html += '<div class="opt-list">';
    q.options.forEach(function (text, i) {
      var cls = 'opt-line';
      var isAns = q.answer.indexOf(i) >= 0;
      var isSel = sel.indexOf(i) >= 0;
      if (isAns) cls += ' is-answer';
      if (isSel && !isAns) cls += ' is-wrong';
      var mark = '';
      if (isAns && isSel) mark = '✅ 你的选择（正确）';
      else if (isAns) mark = '✅ 正确答案';
      else if (isSel) mark = '❌ 你的选择';
      html += '<div class="' + cls + '">' +
        '<span class="opt-label">' + String.fromCharCode(65 + i) + '</span>' +
        '<span class="opt-text">' + esc(text) + '</span>' +
        (mark ? '<span class="opt-mark">' + mark + '</span>' : '') +
      '</div>';
    });
    html += '</div>';
    if (!sel.length) html += '<div class="ans-note">⚠️ 你未作答此题</div>';
    if (q.explain) html += '<div class="exp-note"><strong>解析：</strong>' + esc(q.explain) + '</div>';
    html += '</div>';
    return html;
  }

  /* ---------- 结果弹窗按钮 ---------- */
  document.getElementById('btnExamClose').onclick = function () {
    resultModal.classList.remove('show');
    state = null;
    var btn = document.querySelector('.toolbar button[data-mode="' + Q.getMode() + '"]');
    if (btn) btn.click();
  };
  document.getElementById('btnExamRetry').onclick = function () {
    resultModal.classList.remove('show');
    state = null;
    document.getElementById('btnExam').click();
  };
  resultModal.onclick = function (e) {
    if (e.target === resultModal) document.getElementById('btnExamClose').click();
  };

  /* ---------- 历史记录 ---------- */
  document.getElementById('btnExamHistory').onclick = function () {
    var list = loadHistory();
    if (!list.length) {
      historyBody.innerHTML = '<p style="color:#656d76">还没有考试记录。</p>';
    } else {
      var html = '<table class="history-table"><thead><tr>' +
        '<th>时间</th><th>题数</th><th>正确</th><th>错误</th><th>得分</th><th>用时</th>' +
        '</tr></thead><tbody>';
      list.forEach(function (r) {
        var d = new Date(r.time);
        var ds = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                 ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        html += '<tr>' +
          '<td>' + ds + '</td>' +
          '<td>' + r.total + '</td>' +
          '<td style="color:#16a34a">' + r.right + '</td>' +
          '<td style="color:#dc2626">' + r.wrong + (r.unanswered ? '(+' + r.unanswered + '未答)' : '') + '</td>' +
          '<td><strong>' + r.score + '</strong></td>' +
          '<td>' + formatTime(r.usedTime) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      html += '<div style="margin-top:12px"><button id="btnClearHistory">清空历史记录</button></div>';
      historyBody.innerHTML = html;
      document.getElementById('btnClearHistory').onclick = function () {
        if (confirm('确定清空所有考试记录吗？')) {
          saveHistory([]);
          document.getElementById('btnExamHistory').click();
        }
      };
    }
    historyModal.classList.add('show');
  };
  document.getElementById('btnCloseHistory').onclick = function () { historyModal.classList.remove('show'); };
  historyModal.onclick = function (e) { if (e.target === historyModal) historyModal.classList.remove('show'); };

  window.addEventListener('beforeunload', function () {
    if (timerId) clearInterval(timerId);
  });
})();
