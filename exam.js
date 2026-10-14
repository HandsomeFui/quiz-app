(function () {
  'use strict';
  if (!window.Quiz) return;

  var Q = window.Quiz;
  var card = Q.getCard();

  var setupModal = document.getElementById('examSetupModal');
  var resultModal = document.getElementById('examResultModal');
  var resultBody = document.getElementById('examResultBody');
  var countSel = document.getElementById('examCount');
  var timeSel = document.getElementById('examTime');

  var state = null; // 当前考试状态
  var timerId = null;
  var navEl = null;

  /* ---------- 打开 / 关闭设置弹窗 ---------- */
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

    var list = Q.shuffle(bank.slice());
    if (countVal !== 'all') list = list.slice(0, parseInt(countVal, 10));
    if (!list.length) { alert('题库为空'); return; }

    state = {
      questions: list,
      answers: list.map(function () { return []; }),
      current: 0,
      total: list.length,
      totalTime: timeVal * 60,
      timeLeft: timeVal * 60,
      submitted: false,
      startedAt: Date.now()
    };

    setupModal.classList.remove('show');

    if (timerId) { clearInterval(timerId); timerId = null; }
    if (timeVal > 0) {
      timerId = setInterval(function () {
        state.timeLeft--;
        updateTimer();
        if (state.timeLeft <= 0) {
          clearInterval(timerId); timerId = null;
          finishExam();
        }
      }, 1000);
    }

    renderExam();
  };

  /* ---------- 计时 ---------- */
  function updateTimer() {
    var el = document.getElementById('examTimer');
    if (!el) return;
    if (state.totalTime === 0) { el.textContent = '不限时'; return; }
    var t = state.timeLeft;
    var m = Math.floor(t / 60);
    var s = t % 60;
    el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    el.classList.toggle('warning', t <= 60);
  }

  /* ---------- 渲染考试界面 ---------- */
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
        '<button class="exam-nav-btn" id="btnExamNav">题目导航</button>' +
      '</div>' +
      '<div class="qmeta">' +
        '<span class="tag exam">' + typeName + '</span>' +
        '<span>已答 ' + answered + ' / ' + state.total + '</span>' +
      '</div>' +
      '<div class="question">' + Q.esc(q.question) + '</div>' +
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
      if (confirm(tip)) finishExam();
    };
    document.getElementById('btnExamNav').onclick = openNav;

    updateTimer();
  }

  function onExamOptionClick(i) {
    if (!state || state.submitted) return;
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
  function finishExam() {
    if (!state || state.submitted) return;
    state.submitted = true;
    if (timerId) { clearInterval(timerId); timerId = null; }

    var right = 0, wrong = 0, unanswered = 0;
    var wrongList = [];
    state.questions.forEach(function (q, i) {
      var ans = state.answers[i];
      if (!ans.length) {
        unanswered++;
        wrongList.push({ q: q, sel: [] });
        return;
      }
      if (Q.isCorrect(q, ans)) right++;
      else { wrong++; wrongList.push({ q: q, sel: ans }); }
    });

    // 错题（含未答）加入错题本
    wrongList.forEach(function (item) { Q.addWrong(item.q.id); });
    Q.updateHeader();

    var score = Math.round(right / state.total * 100);

    var html =
      '<div class="result-score ' + (score >= 60 ? 'pass' : 'fail') + '">' + score + ' 分</div>' +
      '<div class="result-detail">共 ' + state.total + ' 题 · 正确 ' + right + ' · 错误 ' + wrong +
        (unanswered ? ' · 未答 ' + unanswered : '') + '</div>';

    if (wrongList.length) {
      html += '<div class="result-wrong-list"><h3>错题回顾</h3>';
      wrongList.forEach(function (item) {
        var q = item.q;
        var correctAns = q.type === 'judge'
          ? q.answer.map(function (n) { return q.options[n]; }).join('、')
          : q.answer.map(function (n) { return String.fromCharCode(65 + n); }).join('、');
        var yourAns = item.sel.length
          ? (q.type === 'judge'
              ? item.sel.map(function (n) { return q.options[n]; }).join('、')
              : item.sel.map(function (n) { return String.fromCharCode(65 + n); }).join('、'))
          : '未作答';
        html +=
          '<div class="result-wrong-item">' +
            '<div class="q">' + Q.esc(q.question) + '</div>' +
            '<div class="a">正确答案：' + Q.esc(correctAns) + '</div>' +
            '<div class="y">你的答案：' + Q.esc(yourAns) + '</div>' +
            (q.explain ? '<div style="margin-top:4px;color:#475569">' + Q.esc(q.explain) + '</div>' : '') +
          '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="result-detail" style="color:#16a34a">🎉 全部正确，太棒了！</div>';
    }

    resultBody.innerHTML = html;
    resultModal.classList.add('show');
  }

  /* ---------- 结果弹窗按钮 ---------- */
  document.getElementById('btnExamClose').onclick = function () {
    resultModal.classList.remove('show');
    state = null;
    // 恢复练习界面
    var btn = document.querySelector('.toolbar button[data-mode="' + Q.getMode() + '"]');
    if (btn) btn.click();
  };
  document.getElementById('btnExamRetry').onclick = function () {
    resultModal.classList.remove('show');
    state = null;
    // 重新打开设置弹窗
    document.getElementById('btnExam').click();
  };
  resultModal.onclick = function (e) {
    if (e.target === resultModal) document.getElementById('btnExamClose').click();
  };

  /* 离开页面时清除定时器 */
  window.addEventListener('beforeunload', function () {
    if (timerId) clearInterval(timerId);
  });
})();