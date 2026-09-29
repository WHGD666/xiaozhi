const Tools = (() => {
  let timerInterval = null;
  let timerSeconds = 25 * 60;
  let timerRunning = false;
  let timerPreset = 25;

  function updateTimerDisplay() {
    const display = document.getElementById('timerDisplay');
    if (!display) return;
    const minutes = Math.floor(timerSeconds / 60);
    const seconds = timerSeconds % 60;
    display.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function updateTimerUI() {
    const btn = document.getElementById('timerStartBtn');
    if (!btn) return;
    btn.textContent = timerRunning ? '暂停' : timerSeconds < timerPreset * 60 ? '继续' : '开始专注';
  }

  function startTimer(minutes) {
    if (minutes) {
      timerPreset = minutes;
      timerSeconds = minutes * 60;
    }
    timerRunning = true;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (!timerRunning) return;
      timerSeconds -= 1;
      updateTimerDisplay();
      if (timerSeconds <= 0) onTimerComplete();
    }, 1000);
    updateTimerUI();
  }

  function pauseTimer() {
    timerRunning = false;
    clearInterval(timerInterval);
    updateTimerUI();
  }

  function resumeTimer() { startTimer(); }

  function resetTimer() {
    timerRunning = false;
    clearInterval(timerInterval);
    timerSeconds = timerPreset * 60;
    updateTimerDisplay();
    updateTimerUI();
  }

  function setTimerPreset(minutes) {
    timerPreset = minutes;
    timerSeconds = minutes * 60;
    timerRunning = false;
    clearInterval(timerInterval);
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.toggle('active', btn.textContent.includes(String(minutes))));
    updateTimerDisplay();
    updateTimerUI();
  }

  function toggleTimer() {
    if (timerRunning) pauseTimer();
    else resumeTimer();
  }

  function onTimerComplete() {
    clearInterval(timerInterval);
    timerRunning = false;
    timerSeconds = timerPreset * 60;
    XiaoZhi.updateStudyStats(timerPreset);
    showToast('番茄钟完成，休息一下吧。', 'success');
    updateTimerDisplay();
    updateTimerUI();
    if (typeof onStudySessionComplete === 'function') onStudySessionComplete(timerPreset);
  }

  function handlePhotoUpload(file) {
    return new Promise(resolve => {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = event => resolve({ dataUrl: event.target.result, name: file.name, size: file.size });
      reader.readAsDataURL(file);
    });
  }

  function saveSetting(key, value) { localStorage.setItem(`xiaozhi_${key}`, JSON.stringify(value)); }
  function loadSetting(key, fallback) {
    const value = localStorage.getItem(`xiaozhi_${key}`);
    if (!value) return fallback;
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function addWrongQuestions(questions, meta = {}) {
    if (!questions?.length) return 0;
    const current = loadSetting('wrongQuestions', []);
    const now = new Date();
    const records = questions.map(question => ({
      id: `${now.getTime()}_${Math.random().toString(16).slice(2)}`,
      subject: meta.subject || '学习',
      topic: meta.topic || '综合练习',
      level: meta.level || '',
      question: question.question,
      options: question.options || [],
      answer: question.answer,
      weakPoint: question.weakPoint || '待复习',
      explanation: question.explanation || '暂无解析',
      createdAt: now.toISOString(),
    }));
    saveSetting('wrongQuestions', [...records, ...current].slice(0, 50));
    return records.length;
  }

  function getWrongQuestions() {
    return loadSetting('wrongQuestions', []);
  }

  function clearWrongQuestions() {
    saveSetting('wrongQuestions', []);
  }

  function savePlan(plan) {
    if (!plan) return;
    const plans = loadSetting('plans', []);
    const item = { id: `${Date.now()}`, ...plan, createdAt: Date.now() };
    saveSetting('plans', [item, ...plans].slice(0, 100));
    return item;
  }

  function getPlans() {
    return loadSetting('plans', []);
  }

  function clearPlans() {
    saveSetting('plans', []);
  }

  function renderWrongBook() {
    const questions = getWrongQuestions();
    if (!questions.length) {
      return '<div class="wrongbook-card empty"><div class="wrongbook-head"><span>错题集</span><strong>暂时还没有错题</strong></div><p>完成一次诊断练习或配套练习后，答错的题目会自动收进这里。</p></div>';
    }

    const groups = questions.reduce((acc, item) => {
      const key = `${item.subject || '学习'} · ${item.topic || '综合练习'}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    return `<div class="wrongbook-card"><div class="wrongbook-head"><div><span>错题集</span><strong>已收录 ${questions.length} 道错题</strong></div><button onclick="clearWrongBook()">清空</button></div>${Object.entries(groups).map(([title, items]) => `<section class="wrongbook-section"><h4>${escapeHtml(title)}</h4>${items.slice(0, 6).map(renderWrongItem).join('')}</section>`).join('')}</div>`;
  }

  function renderWrongItem(item) {
    const date = item.createdAt ? new Date(item.createdAt) : new Date();
    const dateText = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return `<article class="wrongbook-item"><div class="wrongbook-meta"><span>${escapeHtml(item.weakPoint)}</span><time>${dateText}</time></div><p>${escapeHtml(item.question)}</p><div class="wrongbook-answer">正确答案：${escapeHtml(item.answer)}。${escapeHtml(item.explanation)}</div></article>`;
  }

  function getWeeklyData() {
    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const today = new Date().getDay();
    const todayIndex = today === 0 ? 6 : today - 1;
    const base = [35, 55, 40, 70, 50, 85, 0];
    return base.map((minutes, index) => ({ day: days[index], minutes: index === todayIndex ? XiaoZhi.getState().todayStudyMinutes : index < todayIndex ? minutes : 0, isToday: index === todayIndex }));
  }

  function getSubjectDistribution() {
    const topics = XiaoZhi.getStats().topicHistory;
    const colors = ['#2563eb', '#14b8a6', '#f59e0b', '#f43f5e', '#7c3aed'];
    if (!topics.length) {
      return [
        { name: '数学', percent: 35, color: colors[0] },
        { name: '英语', percent: 25, color: colors[1] },
        { name: '编程', percent: 20, color: colors[2] },
        { name: '其他', percent: 20, color: colors[3] },
      ];
    }
    const counts = topics.reduce((acc, name) => ({ ...acc, [name]: (acc[name] || 0) + 1 }), {});
    return Object.entries(counts).map(([name, count], index) => ({ name, percent: Math.round(count / topics.length * 100), color: colors[index % colors.length] }));
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icon = type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle';
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; setTimeout(() => toast.remove(), 250); }, 2600);
  }

  function openTool(toolName) {
    if (toolName === 'timer') return document.getElementById('timerModal')?.classList.add('active');
    if (toolName === 'photo') return triggerPhotoUpload();
    if (toolName === 'summary') {
      switchPage('chat');
      setTimeout(() => UI.addAgentMessage(generateDailySummary(), { customHTML: renderDailySummaryVisual(), quickReplies: ['继续学习', '设定目标', '看统计'] }), 200);
    }
    if (toolName === 'wrongbook') {
      switchPage('chat');
      setTimeout(() => UI.addAgentMessage('这是你最近自动收集的错题和薄弱点。', { customHTML: renderWrongBook(), quickReplies: ['开始学习', '今日总结', '看统计'] }), 200);
    }
    if (toolName === 'goals') {
      switchPage('chat');
      setTimeout(() => {
        if (typeof startStudyFlow === 'function') startStudyFlow();
      }, 200);
    }
  }

  function generateDailySummary() {
    const stats = XiaoZhi.getStats();
    const goal = Math.max(1, Number(XiaoZhi.getState().dailyGoal) || 120);
    const progress = Math.min(100, Math.round(stats.todayStudyMinutes / goal * 100));
    const subjects = stats.todayTopicHistory.length ? stats.todayTopicHistory.join('、') : '尚未开始学习';
    const progressText = stats.todayStudyMinutes > 0 ? `${progress}%` : '尚未开始';
    const encouragement = stats.todayStudyMinutes <= 0
      ? '今天还没有记录到学习时长，选一个小任务开始即可。'
      : progress >= 100 ? '今天的学习目标已经完成，状态很好。' : `距离今日 ${goal} 分钟目标还差 ${Math.max(0, goal - stats.todayStudyMinutes)} 分钟。`;
    return `**今日学习总结**\n\n学习时长：${stats.todayStudyMinutes} 分钟\n已解题目：${stats.problemsSolved} 道\n连续学习：${stats.streakDays} 天\n今日学习方向：${subjects}\n今日进度：${progressText}\n\n${encouragement}`;
  }

  function renderDailySummaryVisual() {
    const stats = XiaoZhi.getStats();
    const goal = Math.max(1, Number(XiaoZhi.getState().dailyGoal) || 120);
    const progress = Math.min(100, Math.round(stats.todayStudyMinutes / goal * 100));
    const wrongCount = getWrongQuestions().length;
    const solved = Math.max(0, stats.problemsSolved || 0);
    const review = Math.min(100, wrongCount ? Math.round(wrongCount / Math.max(1, wrongCount + solved) * 100) : 0);
    const chart = `conic-gradient(var(--brand-500) 0 ${progress}%, var(--assist-500) ${progress}% ${Math.min(100, progress + review)}%, #dbe7f5 ${Math.min(100, progress + review)}% 100%)`;
    const progressLabel = stats.todayStudyMinutes > 0 ? `${progress}%` : '待开始';
    const summaryStatus = stats.todayStudyMinutes > 0 ? '今日进度' : '尚未开始';
    return `<div class="summary-visual-card"><div class="summary-visual-head"><div><span>图形化总结</span><strong>今日学习画像</strong></div><em>${progressLabel}</em></div><div class="summary-visual-body"><div class="summary-donut" style="background:${chart}"><div><strong>${progressLabel}</strong><span>${summaryStatus}</span></div></div><div class="summary-metrics"><div><i class="fas fa-clock"></i><span>学习时长</span><strong>${stats.todayStudyMinutes} / ${goal} 分钟</strong></div><div><i class="fas fa-check-circle"></i><span>已解题目</span><strong>${solved} 道</strong></div><div><i class="fas fa-clipboard-list"></i><span>错题收录</span><strong>${wrongCount} 道</strong></div></div></div><div class="summary-legend"><span><b class="learn"></b>今日进度</span><span><b class="wrong"></b>错题复盘</span><span><b class="rest"></b>待完成</span></div></div>`;
  }

  return { startTimer, pauseTimer, resumeTimer, resetTimer, setTimerPreset, toggleTimer, handlePhotoUpload, saveSetting, loadSetting, getWeeklyData, getSubjectDistribution, showToast, openTool, generateDailySummary, renderDailySummaryVisual, addWrongQuestions, getWrongQuestions, clearWrongQuestions, renderWrongBook, savePlan, getPlans, clearPlans };
})();

function showToast(message, type) { Tools.showToast(message, type); }
