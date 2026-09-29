const XiaoZhi = (() => {
  const state = {
    userName: '同学',
    subject: '学习',
    dailyGoal: 120,
    breakInterval: 45,
    sessionActive: false,
    sessionStart: null,
    lastBreakTime: null,
    todayStudyMinutes: 0,
    problemsSolved: 0,
    streakDays: 1,
    topicHistory: [],
    todayTopicHistory: [],
    conversationHistory: [],
    lastInteractionTime: null,
    lastProactiveTime: null,
    sessionId: 'user_' + Date.now(),
  };

  let apiAvailable = false;
  let degradedNoticeShown = false;
  const API_BASE = window.location.origin;

  function init() {
    const saved = localStorage.getItem('xiaozhi_state');
    if (saved) {
      try { Object.assign(state, JSON.parse(saved)); } catch (_) {}
    }
    state.sessionActive = false;
    state.sessionStart = null;

    const today = new Date().toDateString();
    const lastDate = localStorage.getItem('xiaozhi_lastDate');
    if (lastDate !== today) {
      state.todayStudyMinutes = 0;
      state.problemsSolved = 0;
      state.todayTopicHistory = [];
      if (lastDate) {
        const diffDays = Math.floor((new Date(today) - new Date(lastDate)) / 86400000);
        state.streakDays = diffDays <= 1 ? Math.max(1, state.streakDays + 1) : 1;
      }
      localStorage.setItem('xiaozhi_lastDate', today);
      saveState();
    }
  }

  function saveState() {
    localStorage.setItem('xiaozhi_state', JSON.stringify(state));
    localStorage.setItem('xiaozhi_lastDate', new Date().toDateString());
  }

  async function checkApiStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      const data = await res.json();
      apiAvailable = Boolean(data.hasApiKey);
      return apiAvailable;
    } catch (_) {
      apiAvailable = false;
      return false;
    }
  }

  async function callAI(message) {
    if (!apiAvailable) return { reply: null, error: '当前没有检测到可用的大模型 API Key' };
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId: state.sessionId }),
      });
      const data = await res.json();
      return data.success ? { reply: data.reply, error: '' } : { reply: null, error: data.error || '大模型接口没有返回可用内容' };
    } catch (error) {
      return { reply: null, error: error.message || '网络请求失败' };
    }
  }

  async function routeIntent(message, learningContext = {}) {
    if (!apiAvailable) return { action: 'chat', reasonCode: 'local_mode' };
    try {
      const history = state.conversationHistory.slice(-12).map(item => ({
        role: item.role,
        text: item.text,
      }));
      const res = await fetch(`${API_BASE}/api/route-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, learningContext }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.data) return { action: 'chat', reasonCode: 'router_unavailable' };
      return data.data;
    } catch (_) {
      // 路由失败时保守回到普通对话，绝不因为异常误触发出题。
      return { action: 'chat', reasonCode: 'router_unavailable' };
    }
  }

  function recordConversation(role, text) {
    const content = String(text || '').trim();
    if (!content) return;
    state.lastInteractionTime = Date.now();
    state.conversationHistory.push({ role: role === 'agent' ? 'agent' : 'user', text: content, time: Date.now() });
    state.conversationHistory = state.conversationHistory.slice(-40);
    saveState();
  }

  function detectSubject(text) {
    const subjects = {
      数学: ['数学', '函数', '几何', '方程', '概率', '代数'],
      英语: ['英语', '单词', '语法', '阅读', '作文', '听力'],
      物理: ['物理', '力学', '电学', '运动', '能量'],
      化学: ['化学', '元素', '反应', '分子', '方程式'],
      语文: ['语文', '作文', '古诗', '阅读理解', '文言文'],
      编程: ['编程', '代码', '算法', 'bug', 'Python', 'JavaScript'],
    };
    return Object.keys(subjects).find(subject => subjects[subject].some(word => text.includes(word))) || null;
  }

  function getTimePeriod() {
    const h = new Date().getHours();
    if (h < 6) return 'late_night';
    if (h < 9) return 'morning';
    if (h < 12) return 'forenoon';
    if (h < 14) return 'noon';
    if (h < 18) return 'afternoon';
    if (h < 22) return 'evening';
    return 'night';
  }

  function getTimeGreeting() {
    const name = state.userName || '同学';
    const map = {
      morning: `早上好，${name}！今天想先攻克哪一块内容？`,
      forenoon: `上午好，${name}。这个时间很适合处理难题，我们从一个小目标开始吧。`,
      noon: `中午好，${name}。记得吃饭和休息，学习也要留一点呼吸感。`,
      afternoon: `下午好，${name}。如果有点犯困，我们可以把任务拆小一点来做。`,
      evening: `晚上好，${name}。要不要一起复盘一下今天学了什么？`,
      night: `${name}，夜深了。可以学，但别忘了给大脑收个尾。`,
      late_night: `${name}，已经很晚了。重要的事情可以先记下来，休息也很重要。`,
    };
    return map[getTimePeriod()] || map.afternoon;
  }

  function localResponse(text) {
    const subject = detectSubject(text);
    if (subject && !state.topicHistory.includes(subject)) state.topicHistory.push(subject);
    if (/谢谢|感谢|thanks/i.test(text)) return '不客气。你把问题带来，我负责陪你拆开。';
    if (/累|困|不想学|学不动/.test(text)) return '那就先休息 5 分钟。真正有效的学习不是硬撑，是知道什么时候恢复状态。';
    if (/不会|太难|看不懂|崩溃/.test(text)) return '卡住很正常。把题目或知识点发给我，我们先找“第一步该做什么”。';
    if (/总结|复盘/.test(text)) return Tools.generateDailySummary();
    if (/目标|计划/.test(text)) return `可以。你可以告诉我“今天学什么”和“学多久”，比如：今天学 45 分钟数学。`;
    if (subject) return `收到，是 ${subject}。你可以把具体题目、知识点或困惑发给我，我会按步骤帮你拆解。`;
    return '我在。你可以问我题目、让我制定学习计划，或者让我帮你做今日总结。';
  }

  async function generateResponse(text) {
    recordConversation('user', text);
    const context = `用户：${state.userName}\n今日已学：${state.todayStudyMinutes} 分钟\n当前科目：${state.subject}\n用户消息：${text}`;
    const aiResult = await callAI(context);
    let reply = aiResult.reply;
    let actions = [];
    if (!reply) {
      if (!degradedNoticeShown) {
        degradedNoticeShown = true;
        reply = '当前未检测到可用的大模型 API Key，现已切换至本地学习伙伴模式，可继续陪你学习。\n\n你可以选择：\n① 保持本地模式，点击下面的"开始学习"，我们直接开始（告诉我：今天学哪一科、学习时长）\n② 接入大模型，解锁更强的对话与解题能力';
        actions = [{ type: 'connectAI' }];
      } else {
        reply = '这次大模型暂时没有接上，所以我先用本地学习伙伴模式陪你继续。\n\n原因：当前没有检测到可用的大模型 API Key\n当前功能有限，仅基础学习陪伴可用。可选择接入大模型，解锁小知更强的解析与解题能力。\n\n为了先把学习安排起来，我先问你一些关于学习习惯的问题：你今天准备学哪一科、想学多久、现在是更想复习、做题，还是先补概念？';
      }
    }
    recordConversation('agent', reply);
    return { text: reply, actions };
  }

  async function generatePhotoResponse(fileName) {
    return {
      text: `我已经收到图片“${fileName}”。当前演示版不能真正识别图片内容，你可以把题目文字发出来，我会按“已知条件、解题思路、步骤、答案”帮你讲清楚。`,
      actions: [{ type: 'quickReply', options: ['我来输入题目', '换一种讲法', '看统计'] }],
    };
  }

  function checkProactiveService() {
    const messages = [];
    const now = Date.now();
    if (state.sessionActive && state.lastBreakTime && (now - state.lastBreakTime) / 60000 >= state.breakInterval) {
      messages.push({ text: `你已经连续学习一段时间了。站起来活动一下，回来会更清醒。`, actions: ['休息一下', '继续学习', '看统计'] });
      state.lastBreakTime = now;
      saveState();
    }
    return messages;
  }

  function updateStudyStats(minutes) {
    state.todayStudyMinutes += minutes;
    state.problemsSolved += 1;
    saveState();
  }

  function recordTodayTopic(subject) {
    const normalized = String(subject || '').trim();
    if (!normalized) return;
    if (!state.todayTopicHistory.includes(normalized)) state.todayTopicHistory.push(normalized);
    if (!state.topicHistory.includes(normalized)) state.topicHistory.push(normalized);
    saveState();
  }

  function startSession() {
    if (state.sessionActive && state.sessionStart) stopSession();
    state.sessionActive = true;
    state.sessionStart = Date.now();
    state.lastBreakTime = Date.now();
    saveState();
  }

  function stopSession() {
    if (state.sessionActive && state.sessionStart) {
      const elapsedMinutes = Math.round((Date.now() - state.sessionStart) / 60000);
      if (elapsedMinutes > 0) {
        state.todayStudyMinutes += elapsedMinutes;
        fetch('/api/learning/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: state.subject, durationMinutes: elapsedMinutes }) }).catch(() => {});
      }
    }
    state.sessionActive = false;
    state.sessionStart = null;
    saveState();
  }

  return {
    init, saveState, checkApiStatus, routeIntent, recordConversation, generateResponse, generatePhotoResponse, checkProactiveService,
    getTimeGreeting, getTimePeriod, updateStudyStats, recordTodayTopic, startSession, stopSession,
    setUserName: name => { state.userName = name || '同学'; saveState(); },
    setSubject: subject => { state.subject = subject || '学习'; saveState(); },
    setDailyGoal: goal => { state.dailyGoal = goal; saveState(); },
    setBreakInterval: minutes => { state.breakInterval = minutes; saveState(); },
    getState: () => state,
    getStats: () => ({ todayStudyMinutes: state.todayStudyMinutes, problemsSolved: state.problemsSolved, streakDays: state.streakDays, topicHistory: [...state.topicHistory], todayTopicHistory: [...state.todayTopicHistory], sessionActive: state.sessionActive }),
  };
})();
