const UI = (() => {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function formatMarkdown(text) {
    return escapeHtml(text)
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code class="md-code">$1</code>')
      .replace(/\n/g, '<br>');
  }

  function typesetMath(element) {
    if (!element) return;
    const render = () => {
      if (!window.MathJax?.typesetPromise) return;
      window.MathJax.typesetClear?.([element]);
      window.MathJax.typesetPromise([element]).then(scrollToBottom).catch(error => {
        console.warn('数学公式渲染失败，将保留原始内容。', error);
      });
    };
    if (window.MathJax?.typesetPromise) render();
    else document.addEventListener('xiaozhi:math-ready', render, { once: true });
  }

  function addMessage(role, content, options = {}) {
    const container = document.getElementById('chatMessages');
    if (!container) return null;
    const message = document.createElement('div');
    const isInteractiveCard = Boolean(options.customHTML && /(?:interactive-card|study-plan-card|study-quiz-card|wrongbook-card|summary-visual-card)/.test(options.customHTML));
    message.className = `message ${role}${isInteractiveCard ? ' message-card' : ''}`;
    const icon = role === 'agent' ? 'fas fa-robot' : 'fas fa-user-graduate';
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    let html = '';
    if (options.imageUrl) html += `<div class="message-image-container"><img class="image-preview" src="${options.imageUrl}" alt="上传的图片"></div>`;
    if (isInteractiveCard) {
      html += content ? `<div class="message-card-intro">${formatMarkdown(content)}</div>` : '';
      html += options.customHTML;
    } else {
      html += formatMarkdown(content || '');
      if (options.customHTML) html += options.customHTML;
    }
    let actionsHTML = '';
    if (options.quickReplies?.length) {
      actionsHTML = '<div class="quick-reply">' + options.quickReplies.map((reply, index) => `<button class="quick-reply-btn ${index === 0 ? 'primary-action' : 'secondary-action'}" onclick="handleQuickReply('${escapeHtml(reply)}')">${escapeHtml(reply)}</button>`).join('') + '</div>';
    }
    message.innerHTML = `<div class="message-avatar"><i class="${icon}"></i></div><div class="message-content"><div class="message-bubble${isInteractiveCard ? ' card-message-bubble' : ''}">${html}</div>${actionsHTML}<span class="message-time">${time}</span></div>`;
    container.appendChild(message);
    typesetMath(message);
    scrollToBottom();
    return message;
  }

  function addAgentMessage(content, options = {}) { return addMessage('agent', content, options); }
  function addUserMessage(content, options = {}) { return addMessage('user', content, options); }

  function showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    if (!container || document.getElementById('typingIndicator')) return;
    const typing = document.createElement('div');
    typing.className = 'message agent';
    typing.id = 'typingIndicator';
    typing.innerHTML = '<div class="message-avatar"><i class="fas fa-robot"></i></div><div class="message-content"><div class="message-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div></div>';
    container.appendChild(typing);
    scrollToBottom();
  }

  function removeTypingIndicator() { document.getElementById('typingIndicator')?.remove(); }

  function demoData() {
    const demoSubjects = [
      { name: '高等数学', base: 30, color: '#4f74ff' },
      { name: '线性代数', base: 21, color: '#6654f6' },
      { name: 'Python', base: 26, color: '#ff7a59' },
      { name: '算法与数据结构', base: 24, color: '#34c3a1' },
      { name: '英语', base: 17, color: '#ffb84d' },
      { name: '人工智能', base: 19, color: '#a86bfb' },
      { name: '操作系统', base: 22, color: '#e0558b' },
    ];
    const jittered = demoSubjects.map(item => ({ ...item, percent: Math.max(8, Math.round(item.base + (Math.random() * 10 - 4))) })).sort((a, b) => b.percent - a.percent);
    return {
      stats: { todayStudyMinutes: 156 + Math.round(Math.random() * 60 - 20), problemsSolved: 8 + Math.round(Math.random() * 5), streakDays: 12 + Math.round(Math.random() * 9) },
      weekly: [72, 126, 96, 168, 186, 144, 324].map(value => Math.max(40, Math.round(value + (Math.random() * 72 - 30)))),
      subjects: jittered,
    };
  }

  function syncSourceButton() {
    const demo = window.StudyDataMode.isDemo();
    const card = document.getElementById('srcToolCard');
    if (card) card.classList.toggle('real', !demo);
    const label = document.getElementById('srcToolState');
    if (label) label.textContent = demo ? '点击接入个人学习计划内容' : '已接入个人学习计划内容';
  }

  function toggleStatisticsSource() {
    window.StudyDataMode.toggle();
    syncSourceButton();
    if (typeof renderPlans === 'function') renderPlans();
    renderAnalytics();
    if (document.getElementById('page-dashboard').classList.contains('active')) window.StudyDashboard?.reload?.();
  }

  function renderAnalytics() {
    const demo = window.StudyDataMode.isDemo() ? demoData() : null;
    const stats = demo ? { ...XiaoZhi.getStats(), ...demo.stats } : XiaoZhi.getStats();
    const state = XiaoZhi.getState();
    document.getElementById('totalStudyTime').textContent = stats.todayStudyMinutes;
    document.getElementById('problemsSolved').textContent = stats.problemsSolved;
    document.getElementById('streakDays').textContent = stats.streakDays;
    document.getElementById('focusScore').textContent = stats.todayStudyMinutes > 0 ? `${Math.min(100, Math.round(stats.todayStudyMinutes / state.dailyGoal * 100))}%` : '--';
    document.getElementById('profileStreak').textContent = `连续学习 ${stats.streakDays} 天`;
    const goal = Math.max(1, Number(state.dailyGoal) || 120);
    const progress = Math.min(100, Math.round(stats.todayStudyMinutes / goal * 100));
    const topbarGoal = document.getElementById('topbarGoal');
    const topbarStreak = document.getElementById('topbarStreak');
    if (topbarGoal) topbarGoal.innerHTML = `<i class="fas fa-circle-check"></i> 今日进度 · ${stats.todayStudyMinutes > 0 ? `${progress}%` : '待开始'}`;
    if (topbarStreak) topbarStreak.innerHTML = `<i class="fas fa-fire"></i> 连续学习 ${stats.streakDays} 天`;
    syncSourceButton();
    renderWeeklyChart(demo);
    renderSubjectChart(demo);
  }

  function renderWeeklyChart(demo) {
    const container = document.getElementById('weeklyChart');
    if (!container) return;
    const todayMinutes = XiaoZhi.getStats().todayStudyMinutes;
    const todayIndex = (new Date().getDay() + 6) % 7;
    const data = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day, index) => ({ day, minutes: demo ? demo.weekly[index] : (index === todayIndex ? todayMinutes : 0), isToday: index === todayIndex }));
    const max = Math.max(...data.map(item => item.minutes), 60);
    const total = data.reduce((sum, item) => sum + item.minutes, 0);
    const totalNode = document.getElementById('weeklyTotal');
    const summaryTotal = document.getElementById('weeklySummaryTotal');
    const summaryText = document.getElementById('weeklySummaryText');
    if (totalNode) totalNode.textContent = `${total} min`;
    if (summaryTotal) summaryTotal.textContent = `${total} min`;
    if (summaryText) summaryText.textContent = total ? `本周目前已完成 ${total} 分钟学习，继续保持今天的节奏。` : '开始一次学习后，这里会出现你的本周节奏。';
    container.innerHTML = data.map(item => {
      const height = item.minutes > 0 ? Math.max(8, item.minutes / max * 150) : 3;
      return `<div class="chart-bar-wrapper"><span class="chart-value">${item.minutes ? item.minutes + ' 分' : ''}</span><div class="chart-bar ${item.minutes ? '' : 'empty'} ${item.isToday ? 'today' : ''}" style="height:${height}px"></div><span class="chart-label">${item.day}${item.isToday ? '<small>TODAY</small>' : ''}</span></div>`;
    }).join('');
  }

  function renderSubjectChart(demo) {
    const container = document.getElementById('subjectList');
    if (!container) return;
    const hasStudyRecord = XiaoZhi.getStats().todayStudyMinutes > 0;
    const data = demo ? demo.subjects : (hasStudyRecord ? Tools.getSubjectDistribution() : []);
    const overview = document.getElementById('subjectOverview');
    if (overview) overview.textContent = data.length ? `已记录 ${data.length} 个学习方向` : '等待学习记录';
    container.innerHTML = data.length ? data.map(item => `<div class="subject-item"><span class="subject-name">${item.name}</span><div class="subject-bar-bg"><div class="subject-bar-fill" style="width:${item.percent}%;background:${item.color}"></div></div><span class="subject-percent">${item.percent}%</span></div>`).join('') : '<p class="analytics-empty-note">完成一次有效学习后，这里会按真实学习方向展示投入分布。</p>';
  }

  function switchPage(pageName) {
    if (pageName !== 'dashboard' && document.getElementById('page-dashboard')?.classList.contains('active')) window.StudyDashboard?.destroy?.();
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(`page-${pageName}`)?.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === pageName));
    document.getElementById('sidebar')?.classList.remove('open');
    if (pageName === 'analytics') renderAnalytics();
    if (pageName === 'plans') renderPlans();
    if (pageName === 'tools') syncSourceButton();
  }

  function toggleSidebar() { document.getElementById('sidebar')?.classList.toggle('open'); }
  function showModal(id) { document.getElementById(id)?.classList.add('active'); }
  function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }
  function scrollToBottom() {
    const moveToEnd = () => {
      const el = document.getElementById('chatMessages');
      if (el) el.scrollTop = el.scrollHeight;
    };
    requestAnimationFrame(moveToEnd);
    setTimeout(moveToEnd, 80);
    setTimeout(moveToEnd, 240);
  }
  function showWelcomeMessage() { setTimeout(() => addAgentMessage(XiaoZhi.getTimeGreeting(), { quickReplies: ['开始学习', '设定目标', '今日总结'] }), 300); }

  return { addMessage, addAgentMessage, addUserMessage, showTypingIndicator, removeTypingIndicator, typesetMath, renderAnalytics, switchPage, toggleSidebar, showModal, closeModal, scrollToBottom, showWelcomeMessage, toggleStatisticsSource };
})();

function switchPage(name) { UI.switchPage(name); }
function toggleSidebar() { UI.toggleSidebar(); }
function showModal(id) { UI.showModal(id); }
function closeModal(id) { UI.closeModal(id); }
function addAgentMessage(content, opts) { return UI.addAgentMessage(content, opts); }
function toggleStatisticsSource() { UI.toggleStatisticsSource(); }
