(function () {
  'use strict';

  const subjectPresets = ['数据结构', '数学', '英语', '编程', '物理', '化学'];
  const timePresets = [25, 30, 45, 60, 90, 120, 150, 180];
  const topicPresets = {
    数据结构: ['线性表', '栈和队列', '树与二叉树', '图', '排序算法', '查找与哈希'],
    编程: ['语法基础', '函数', '面向对象', '算法题', '项目练习', '调试能力'],
    数学: ['数与式', '函数', '几何', '方程', '概率统计', '导数与积分'],
    英语: ['单词', '语法', '阅读', '写作', '听力', '翻译'],
    物理: ['力学', '电学', '运动学', '能量守恒', '电磁学', '光学'],
    化学: ['元素周期律', '化学方程式', '氧化还原', '有机化学', '实验题', '计算题'],
  };
  const levelPresets = {
    数学: ['小学', '初中', '高中', '大学'],
    英语: ['小学', '初中', '高中', '大学/四六级'],
    物理: ['初中', '高中', '大学基础', '竞赛入门'],
    化学: ['初中', '高中', '大学基础', '竞赛入门'],
  };
  const modePresets = [
    { key: 'review', title: '直接复习', desc: '不先做题，直接安排按时间推进的复习计划。' },
    { key: 'quiz-review', title: '先测再复习', desc: '先做一套题，再按错题和模块生成复习计划。' },
    { key: 'learn-practice', title: '先学后练', desc: '先安排学习时间，再给练习题和复盘计划。' },
  ];

  let flow = freshFlow();

  XiaoZhi.init();
  loadSettings();
  UI.showWelcomeMessage();
  XiaoZhi.checkApiStatus().then(() => refreshApiStatus());

  setInterval(() => {
    if (document.getElementById('page-analytics')?.classList.contains('active')) UI.renderAnalytics();
    XiaoZhi.checkProactiveService().forEach(message => UI.addAgentMessage(message.text, { quickReplies: message.actions }));
  }, 30000);

  function freshFlow(overrides = {}) {
    return { subject: '', level: '', topic: '', difficulty: '', mode: '', minutes: 0, questionCount: 4, plan: null, quiz: null, quizSubmitted: false, answers: {}, aiOptions: null, aiOptionsLoading: false, ...overrides };
  }

  window.sendMessage = async function () {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const text = input.value.trim();
    if (!text) return;

    UI.addUserMessage(text);
    input.value = '';
    sendBtn.disabled = true;
    UI.showTypingIndicator();
    try {
      const decision = await XiaoZhi.routeIntent(text, getIntentRoutingContext());
      if (decision.action === 'clarify') {
        const question = decision.clarifyingQuestion || '可以。你想练哪个学科和具体知识点？';
        rememberPartialQuizRequest(decision.quizRequest || {});
        XiaoZhi.recordConversation('user', text);
        XiaoZhi.recordConversation('agent', question);
        UI.removeTypingIndicator();
        UI.addAgentMessage(question);
        return;
      }
      if (decision.action === 'quiz') {
        await startConversationQuiz(text, decision.quizRequest || {});
        return;
      }

      const intent = parseStudyIntent(text);
      if (intent.shouldStart) {
        XiaoZhi.recordConversation('user', text);
        UI.removeTypingIndicator();
        beginLearningIntent(intent);
        return;
      }

      handleStudyIntent(text);
      const response = await XiaoZhi.generateResponse(text);
      UI.removeTypingIndicator();
      const hasConnectAI = (response.actions || []).some(action => action.type === 'connectAI');
      UI.addAgentMessage(response.text, {
        quickReplies: getQuickReplies(text, response.actions),
        customHTML: hasConnectAI ? '<div class="inline-connect-btn"><button onclick="openAiSetup()"><i class="fas fa-plug"></i> 接入大模型</button></div>' : '',
      });
      UI.renderAnalytics();
    } catch (error) {
      UI.removeTypingIndicator();
      UI.addAgentMessage('刚才处理消息时出了点问题，请再试一次。');
      console.error(error);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  };

  function getIntentRoutingContext() {
    const state = XiaoZhi.getState();
    const hasQuizContext = Boolean(flow.subject && flow.topic && flow.quiz?.questions?.length);
    return {
      subject: flow.subject || (state.subject === '学习' ? '' : state.subject),
      level: flow.level || '',
      topic: flow.topic || '',
      difficulty: flow.difficulty || '',
      quizActive: Boolean(flow.quiz?.questions?.length && !flow.quizSubmitted),
      lastQuizSpec: hasQuizContext ? {
        subject: flow.subject,
        level: flow.level,
        topic: flow.topic,
        difficulty: flow.difficulty,
        count: flow.questionCount || flow.quiz.questions.length || 4,
      } : null,
    };
  }

  function rememberPartialQuizRequest(quizRequest) {
    if (quizRequest.subject) flow.subject = String(quizRequest.subject).trim();
    if (quizRequest.level) flow.level = String(quizRequest.level).trim();
    if (quizRequest.topic) flow.topic = String(quizRequest.topic).trim();
    if (quizRequest.difficulty) flow.difficulty = String(quizRequest.difficulty).trim();
    if (Number(quizRequest.count) > 0) flow.questionCount = Math.min(8, Math.max(1, Number(quizRequest.count)));
  }

  async function startConversationQuiz(userText, quizRequest) {
    const count = Math.min(8, Math.max(1, Number(quizRequest.count) || 4));
    flow = freshFlow({
      subject: String(quizRequest.subject || '').trim(),
      level: String(quizRequest.level || '').trim(),
      topic: String(quizRequest.topic || '').trim(),
      difficulty: String(quizRequest.difficulty || '').trim(),
      mode: 'quiz-review',
      minutes: flow.minutes || 45,
      questionCount: count,
    });
    XiaoZhi.recordConversation('user', userText);
    XiaoZhi.setSubject(flow.subject);
    XiaoZhi.recordTodayTopic(flow.subject);
    const introduction = `好的，我会围绕 **${flow.subject} - ${flow.topic}** 生成 ${count} 道题，并用交互卡片记录你的作答结果。`;
    XiaoZhi.recordConversation('agent', introduction);
    UI.removeTypingIndicator();
    UI.addAgentMessage(introduction);
    await showQuizFromAI('随堂练习');
    UI.renderAnalytics();
  }

  function parseStudyIntent(text) {
    const clean = text.replace(/[，。！!？?]/g, ' ').trim();
    const minutesMatch = clean.match(/(\d+)\s*(分钟|分|小时|个小时|h|H)/);
    let minutes = 0;
    if (minutesMatch) {
      minutes = Number(minutesMatch[1]);
      if (/小时|个小时|h|H/.test(minutesMatch[2])) minutes *= 60;
    }

    const shouldStart = /开始学习|我要学习|我想学习|想学习|学一下|复习|学习计划|设定目标|设置目标|定个目标|先测|做题/.test(clean);
    let subject = '';
    let topic = '';
    let mode = '';
    let level = '';

    for (const candidate of Object.keys(topicPresets)) if (clean.includes(candidate)) subject = candidate;
    if (!subject && /算法|代码|编程/.test(clean)) subject = '编程';
    if (!subject && /英语|单词|语法/.test(clean)) subject = '英语';
    if (!subject && /数学|函数|方程|概率|几何/.test(clean)) subject = '数学';

    for (const candidate of ['小学', '初中', '高中', '大学', '四六级']) if (clean.includes(candidate)) level = candidate;
    if (/直接复习|只复习/.test(clean)) mode = 'review';
    if (/先测|先做题|先复习再学习|测完再复习/.test(clean)) mode = 'quiz-review';
    if (/先学后练|学习再练|先学习/.test(clean)) mode = 'learn-practice';

    if (subject) {
      const topics = topicPresets[subject] || [];
      topic = topics.find(item => clean.includes(item)) || '';
      if (subject === '数据结构' && /二叉树|树/.test(clean)) topic = '树与二叉树';
      if (subject === '数据结构' && /队列|栈/.test(clean)) topic = '栈和队列';
      if (subject === '数据结构' && /哈希/.test(clean)) topic = '查找与哈希';
    }

    return { shouldStart, subject, topic, minutes, mode, level };
  }

  function beginLearningIntent(intent = {}) {
    flow = freshFlow(intent);
    if (!flow.subject) return UI.addAgentMessage('先选一下今天要学什么。', { customHTML: renderSubjectCard() });
    continueFlow();
  }

  async function continueFlow() {
    await loadAiLearningOptions();
    if (needsLevel(flow.subject) && !flow.level) return UI.addAgentMessage(`先确认一下 **${flow.subject}** 的学习阶段。`, { customHTML: renderLevelCard(flow.subject) });
    if (!flow.topic && hasTopicChoices(flow.subject)) return UI.addAgentMessage(`你想学习 **${flow.subject}${flow.level ? `（${flow.level}）` : ''}** 的哪一块？`, { customHTML: renderTopicCard(flow.subject) });
    if (!flow.topic) flow.topic = flow.subject;
    if (!flow.mode) return UI.addAgentMessage('这次你想用哪种学习方式？', { customHTML: renderModeCard() });
    if (!flow.minutes) return UI.addAgentMessage(`好的，今天聚焦 **${flow.subject} - ${flow.topic}**。准备安排多久？`, { customHTML: renderTimeCard() });
    runSelectedMode();
  }

  async function loadAiLearningOptions() {
    if (!flow.subject || flow.aiOptions || flow.aiOptionsLoading) return;
    flow.aiOptionsLoading = true;
    try {
      const response = await fetch('/api/learning-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: flow.subject, level: flow.level }),
      });
      const payload = await response.json();
      if (response.ok && payload.success && payload.data) flow.aiOptions = payload.data;
    } catch (error) {
      console.warn('无法生成动态学习选项，将使用本地兜底。', error);
    } finally {
      flow.aiOptionsLoading = false;
    }
  }

  window.startStudyFlow = function () { beginLearningIntent({ shouldStart: true }); };

  function renderSubjectCard() {
    const inputId = `subjectInput-${Date.now()}`;
    return `<div class="interactive-card subject-card"><div class="card-kicker">第 1 步</div><div class="card-title">今天学什么？</div><p class="card-helper">选择一个学习方向，我会帮你规划今天的学习内容。</p>${renderRecentSection(getRecentSubjects(), 'selectStudySubject')}<div class="card-section"><div class="section-title">常用学科</div><div class="choice-grid subject-choice-grid">${subjectPresets.map(subject => subjectChoiceButton(subject)).join('')}</div></div><div class="card-section"><div class="section-title">自定义学科</div><div class="custom-entry"><input id="${inputId}" type="text" placeholder="例如：操作系统、英语四级、线性代数"><button onclick="submitCustomSubject('${inputId}')">添加</button></div></div></div>`;
  }

  window.selectStudySubject = function (encodedSubject) {
    flow.subject = decodeChoice(encodedSubject);
    flow.level = '';
    flow.topic = '';
    flow.aiOptions = null;
    UI.addUserMessage(flow.subject);
    advanceFlowWithFeedback();
  };

  window.submitCustomSubject = function (inputId) {
    const value = document.getElementById(inputId)?.value.trim();
    if (!value) return showToast('先输入一个自定义学科', 'warning');
    saveRecent('recentSubjects', value);
    selectStudySubject(encodeChoice(value));
  };

  function renderLevelCard(subject) {
    const levels = flow.aiOptions?.levels?.length ? flow.aiOptions.levels : (levelPresets[subject] || []);
    return `<div class="interactive-card level-card"><div class="card-kicker">学段</div><div class="card-title">${escapeHtml(subject)} 学到哪个阶段？</div><div class="choice-grid">${levels.map(level => choiceButton(level, 'selectStudyLevel')).join('')}</div></div>`;
  }

  window.selectStudyLevel = function (encodedLevel) {
    flow.level = decodeChoice(encodedLevel);
    flow.aiOptions = null;
    UI.addUserMessage(flow.level);
    advanceFlowWithFeedback();
  };

  function advanceFlowWithFeedback() {
    UI.showTypingIndicator();
    continueFlow().finally(() => UI.removeTypingIndicator());
  }

  function renderTopicCard(subject) {
    const inputId = `topicInput-${Date.now()}`;
    const presets = flow.aiOptions?.topics?.length ? flow.aiOptions.topics : (topicPresets[subject] || []);
    return `<div class="interactive-card topic-card"><div class="card-kicker">章节</div><div class="card-title">${escapeHtml(subject)} 学哪里？</div>${renderRecentSection(getRecentTopics(subject), 'selectStudyTopic')}<div class="card-section"><div class="section-title">推荐模块</div><div class="choice-grid">${presets.map(topic => choiceButton(topic, 'selectStudyTopic')).join('')}</div></div><div class="card-section"><div class="section-title">自定义模块</div><div class="custom-entry"><input id="${inputId}" type="text" placeholder="例如：二叉树遍历、三角函数、极限"><button onclick="submitCustomTopic('${inputId}')">添加</button></div></div></div>`;
  }

  window.selectStudyTopic = function (encodedTopic) {
    flow.topic = decodeChoice(encodedTopic);
    UI.addUserMessage(flow.topic);
    continueFlow();
  };

  window.submitCustomTopic = function (inputId) {
    const value = document.getElementById(inputId)?.value.trim();
    if (!value) return showToast('先输入一个自定义模块', 'warning');
    saveRecent(getTopicRecentKey(flow.subject), value);
    selectStudyTopic(encodeChoice(value));
  };

  function renderModeCard() {
    const modes = flow.aiOptions?.modes?.length ? flow.aiOptions.modes : modePresets;
    return `<div class="interactive-card mode-card"><div class="card-kicker">学习方式</div><div class="card-title">你想怎么安排？</div><div class="mode-grid">${modes.map(mode => `<button class="mode-choice" onclick="selectStudyMode('${mode.key}')"><strong>${escapeHtml(mode.title)}</strong><span>${escapeHtml(mode.desc)}</span></button>`).join('')}</div></div>`;
  }

  window.selectStudyMode = function (mode) {
    flow.mode = mode;
    const modes = flow.aiOptions?.modes?.length ? flow.aiOptions.modes : modePresets;
    const label = modes.find(item => item.key === mode)?.title || '学习方式';
    UI.addUserMessage(label);
    continueFlow();
  };

  function renderTimeCard() {
    const inputId = `timeInput-${Date.now()}`;
    return `<div class="interactive-card time-card"><div class="card-kicker">时长</div><div class="card-title">准备安排多久？</div>${renderRecentSection(getRecentTimes().map(formatMinutes), 'selectStudyDurationLabel')}<div class="card-section"><div class="section-title">常用时长</div><div class="choice-grid time-grid">${timePresets.map(minutes => timeButton(minutes)).join('')}</div></div><div class="card-section"><div class="section-title">自定义时长</div><div class="custom-entry"><input id="${inputId}" type="number" min="5" max="480" placeholder="输入分钟数"><button onclick="submitCustomTime('${inputId}')">添加</button></div></div></div>`;
  }

  window.selectStudyDurationLabel = function (encodedLabel) {
    const label = decodeChoice(encodedLabel);
    const hoursMatch = label.match(/(\d+)\s*小时(?:\s*(\d+)\s*分钟)?/);
    const minuteMatch = label.match(/(\d+)\s*分钟/);
    const minutes = hoursMatch ? Number(hoursMatch[1]) * 60 + Number(hoursMatch[2] || 0) : minuteMatch ? Number(minuteMatch[1]) : 0;
    selectStudyDuration(minutes);
  };

  window.selectStudyDuration = function (minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) return;
    flow.minutes = value;
    UI.addUserMessage(formatMinutes(value));
    runSelectedMode();
  };

  window.submitCustomTime = function (inputId) {
    const minutes = Number(document.getElementById(inputId)?.value);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) return showToast('请输入 5 到 480 之间的分钟数', 'warning');
    saveRecent('recentTimes', minutes);
    selectStudyDuration(minutes);
  };

  async function runSelectedMode() {
    normalizeFlow();
    XiaoZhi.setSubject(flow.subject);
    XiaoZhi.recordTodayTopic(flow.subject);
    XiaoZhi.startSession();
    flow.answers = {};

    if (flow.mode === 'review') {
      const plan = buildReviewPlan([], { mode: 'direct' });
      UI.addAgentMessage('已为你生成直接复习计划。', { customHTML: renderReviewPlanCard([], plan, '直接复习计划') });
      persistPlan('直接复习计划', plan);
      UI.renderAnalytics();
      return;
    }

    if (flow.mode === 'quiz-review') {
      UI.addAgentMessage('先做一套诊断题，我会根据结果安排复习时间。');
      await showQuizFromAI('诊断练习');
      UI.renderAnalytics();
      return;
    }

    flow.plan = buildLearningPlan(flow.subject, flow.topic, flow.minutes);
    UI.addAgentMessage('学习计划已经生成，学习、复习和练习都会安排进去。', { customHTML: renderPlanCard(flow.plan) });
    persistPlan('学习计划', flow.plan);
    await showQuizFromAI('配套练习');
    UI.renderAnalytics();
  }

  async function showQuizFromAI(label) {
    UI.showTypingIndicator();
    flow.quiz = await generateQuiz(flow.subject, flow.topic, flow.level, flow.mode, flow.questionCount, flow.difficulty);
    flow.quizSubmitted = false;
    UI.removeTypingIndicator();
    document.querySelectorAll('.study-quiz-card.active-quiz-card').forEach(card => {
      card.classList.remove('active-quiz-card');
      card.classList.add('archived-quiz-card');
      card.querySelectorAll('.quiz-option, .card-actions button').forEach(button => { button.disabled = true; });
    });
    UI.addAgentMessage(flow.quiz.fromAI ? `${label}已生成，题目会贴合当前模块和学段。` : `这次没有生成达到质量标准的学科题，因此没有用泛泛的本地题凑数。${flow.quiz.fallbackReason ? `\n\n原因：${flow.quiz.fallbackReason}` : ''}`, { customHTML: renderQuizCard(flow.quiz) });
  }

  function normalizeFlow() {
    if (!flow.subject) flow.subject = '学习';
    if (!flow.topic) flow.topic = flow.subject;
    if (!flow.mode) flow.mode = 'learn-practice';
    if (!flow.minutes) flow.minutes = 45;
  }

  function buildLearningPlan(subject, topic, minutes) {
    const blocks = [];
    const add = blockAdder(blocks, minutes);
    if (minutes <= 30) {
      add(6, '目标确认', `明确 ${levelText()}${topic} 今天要掌握的核心点。`, 'review', [
        `写下 ${topic} 今天最想解决的 1 个问题。`,
        '翻开目录或笔记，圈出本次只学 1-2 个小点。',
        '把最终产出定为：能说清概念，并完成 1 道例题。'
      ]);
      add(Math.max(12, minutes - 12), '核心学习', `学习 ${topic} 的概念、步骤和典型例题。`, 'study', [
        `先读 ${topic} 的定义、公式或规则，标出关键词。`,
        '跟着例题逐步写一遍，不直接看最终答案。',
        '遇到卡点时在旁边写“卡在哪里”，先不拖太久。'
      ]);
      add(6, '即时复述', '合上资料，用自己的话复述关键思路。', 'review', [
        `用 3 句话复述 ${topic} 的核心方法。`,
        '检查刚才那道例题能不能独立写出第一步。',
        '记录 1 个下一次优先复习的薄弱点。'
      ]);
    } else if (minutes <= 60) {
      add(8, '预热复习', `回顾 ${topic} 的前置知识和易错点。`, 'review', [
        `快速翻看 ${topic} 上一次的笔记或错题。`,
        '把已经会的内容打勾，把模糊点单独列出来。',
        '选出今天最需要补的一处薄弱点。'
      ]);
      add(22, '核心学习', `系统学习 ${topic} 的定义、方法和例题。`, 'study', [
        `按“概念-步骤-例题”学习 ${topic}。`,
        '每学完一个小点，立刻用自己的话写一句解释。',
        '把例题步骤拆成 3-5 个动作，特别标出容易错的条件。'
      ]);
      add(5, '短休息', '离开屏幕，活动一下。', 'break', [
        '离开座位，活动肩颈和手腕。',
        '喝水，眼睛看远处 30 秒。',
        '回来后只看刚才标出的薄弱点继续。'
      ]);
      add(minutes - 43, '练习巩固', '完成典型题，记录卡住的位置。', 'practice', [
        `完成 2-3 道 ${topic} 典型题。`,
        '每题先写思路，再写步骤，最后对答案。',
        '错题只记录错因，不抄整段答案。'
      ]);
      add(8, '收束复盘', '整理今天最重要的 3 条结论。', 'review', [
        '写下今天掌握的 3 个关键词。',
        '把错题归类为概念不清、步骤遗漏或审题问题。',
        '给下一次学习留下一个明确入口。'
      ]);
    } else {
      add(12, '预热复习', `复习 ${topic} 的前置知识。`, 'review', [
        `浏览 ${topic} 的目录、公式和上次错题。`,
        '列出 2 个已经会的点和 2 个还不稳的点。',
        '确定本轮学习只攻克最关键的薄弱点。'
      ]);
      add(35, '第一轮学习', `系统学习 ${levelText()}${topic} 的核心规则和题型。`, 'study', [
        `阅读或观看 ${topic} 核心讲解，边看边补笔记。`,
        '每 10 分钟暂停一次，写下“这个方法什么时候用”。',
        '把典型题型整理成：条件、方法、易错点。'
      ]);
      add(8, '休息', '补水、走动，降低疲劳。', 'break', [
        '离开屏幕，走动或拉伸。',
        '不要刷短视频，避免注意力被切走。',
        '回来前看一眼刚才列出的薄弱点。'
      ]);
      add(32, '例题训练', '做典型题并写出完整步骤。', 'practice', [
        `完成 3-5 道 ${topic} 代表题。`,
        '先限时独立做，再对照解析补步骤。',
        '每道错题写一句“下次看到什么条件要警觉”。'
      ]);
      add(8, '休息', '短暂放松，准备复盘。', 'break', [
        '活动身体，放松眼睛。',
        '简单回想刚才错得最多的原因。',
        '准备把错题合并成薄弱点。'
      ]);
      add(minutes - 107, '回看与整理', '回看错题和卡点，整理下一轮要复习的内容。', 'review', [
        '把错题按同一错因合并，不重复抄题。',
        `整理一张 ${topic} 小抄：公式、步骤、陷阱。`,
        '选 1 个最不稳的点，安排到下一轮复习开头。'
      ]);
      add(12, '小测验', '完成配套练习，根据结果调整复习计划。', 'quiz', [
        '完成下面的配套练习题。',
        '提交后按错题生成复习时间表。',
        '如果全对，就改成轻量巩固计划。'
      ]);
    }
    return { subject, level: flow.level, topic, minutes, blocks: blocks.filter(item => item.duration > 0) };
  }

  function buildReviewPlan(wrongQuestions = [], options = {}) {
    const wrongWeakPoints = wrongQuestions.map(q => q.weakPoint).filter(Boolean);
    const modulePoints = getModuleReviewPoints(flow.subject, flow.topic, flow.level);
    const weakPoints = wrongWeakPoints.length ? [...new Set(wrongWeakPoints)] : modulePoints;
    const ratio = options.mode === 'direct' ? 1 : wrongWeakPoints.length ? .72 : .38;
    const total = Math.max(12, Math.round(flow.minutes * ratio));
    const blocks = [];
    const add = blockAdder(blocks, total);

    if (wrongWeakPoints.length) {
      add(Math.round(total * .2), '错因定位', `定位薄弱点：${weakPoints.join('、')}。`, 'review', [
        '逐题回看错误选项，判断是概念、审题还是步骤问题。',
        `把薄弱点归并为：${weakPoints.join('、')}。`,
        '每个薄弱点只写一句最核心的错因。'
      ]);
      add(Math.round(total * .38), '针对复习', `重点复习 ${weakPoints[0]}，补齐相关概念和公式。`, 'review', [
        `重看 ${weakPoints[0]} 的定义、规则或固定搭配。`,
        '用自己的话写出判断方法，不直接背答案。',
        '整理 2 条下次做题前要检查的提醒。'
      ]);
      add(Math.round(total * .28), '同类练习', '做 2-3 道同类题，观察是否还犯同样错误。', 'practice', [
        '先独立完成同类题，再看解析。',
        '每题对照刚才的提醒检查一遍。',
        '如果继续错，把错因追加到薄弱点后面。'
      ]);
      add(total, '复盘收束', '记录错因、正确方法和下一次先看的知识点。', 'review', [
        '写下本轮最常见的 1 个错误。',
        '把正确解题步骤压缩成 3 步。',
        '标记下一次开头要先看的知识点。'
      ]);
    } else {
      add(Math.round(total * .28), '模块回顾', `快速回顾 ${flow.topic} 的关键概念。`, 'review', [
        `翻看 ${flow.topic} 的核心概念和例题标题。`,
        '不看答案，先说出每个概念的使用场景。',
        '圈出 1 个最容易混淆的点。'
      ]);
      add(Math.round(total * .32), '重点巩固', `围绕 ${weakPoints[0]} 做主动回忆。`, 'review', [
        `合上资料，默写 ${weakPoints[0]} 的判断方法。`,
        '对照笔记补掉遗漏的条件。',
        '写一个自己的例子验证是否理解。'
      ]);
      add(Math.round(total * .25), '轻量练习', '做 1-2 道代表题保持手感。', 'practice', [
        '完成 1-2 道代表题或阅读练习。',
        '重点检查步骤是否完整。',
        '把不确定的地方标为下一次问题。'
      ]);
      add(total, '复盘收束', '整理本模块的易错提醒。', 'review', [
        `总结 ${flow.topic} 的 3 条易错提醒。`,
        '记录今天完成了什么、还差什么。',
        '给下一次学习设一个 10 分钟启动任务。'
      ]);
    }
    return { total, weakPoints, blocks: blocks.filter(item => item.duration > 0) };
  }

  function persistPlan(title, plan) {
    if (!plan) return;
    const type = title === '学习计划' ? 'learning' : title === 'AI 针对性复习安排' ? 'ai' : 'review';
    const minutes = plan.minutes || plan.total || 0;
    Tools.savePlan({
      title,
      type,
      subject: plan.subject || flow.subject || '学习',
      level: plan.level || flow.level || '',
      topic: plan.topic || flow.topic || '',
      minutes,
      weakPoints: plan.weakPoints || [],
      blocks: plan.blocks || [],
    });
  }

  function blockAdder(blocks, totalMinutes) {
    const start = new Date();
    let used = 0;
    return (duration, title, detail, type = 'study', tasks = []) => {
      const left = totalMinutes - used;
      const actual = Math.min(Math.max(0, duration), left);
      if (actual <= 0) return;
      const from = new Date(start.getTime() + used * 60000);
      const to = new Date(from.getTime() + actual * 60000);
      blocks.push({ time: `${timeText(from)}-${timeText(to)}`, duration: actual, title, detail, type, tasks });
      used += actual;
    };
  }

  function renderPlanCard(plan) {
    return `<div class="study-plan-card"><div class="plan-card-head"><div><span>学习计划</span><strong>${escapeHtml(plan.subject)}${plan.level ? ` · ${escapeHtml(plan.level)}` : ''} · ${escapeHtml(plan.topic)}</strong></div><em>${formatMinutes(plan.minutes)}</em></div><div class="schedule-list">${plan.blocks.map(renderScheduleRow).join('')}</div></div>`;
  }

  function renderReviewPlanCard(wrongQuestions, reviewPlan = buildReviewPlan(wrongQuestions), title = wrongQuestions.length ? '错题复习计划' : '模块巩固计划') {
    return `<div class="study-plan-card review-plan-card"><div class="plan-card-head"><div><span>${escapeHtml(title)}</span><strong>${escapeHtml(flow.subject)}${flow.level ? ` · ${escapeHtml(flow.level)}` : ''} · ${escapeHtml(flow.topic)}</strong></div><em>${formatMinutes(reviewPlan.total)}</em></div><div class="weak-list">${reviewPlan.weakPoints.map(point => `<span>${escapeHtml(point)}</span>`).join('')}</div><div class="schedule-list">${reviewPlan.blocks.map(renderScheduleRow).join('')}</div></div>`;
  }

  function renderScheduleRow(block) {
    const tasks = Array.isArray(block.tasks) && block.tasks.length ? `<ul class="schedule-tasks">${block.tasks.map(task => `<li>${escapeHtml(task)}</li>`).join('')}</ul>` : '';
    return `<div class="schedule-row ${block.type}"><div class="schedule-time">${block.time}</div><div class="schedule-dot"></div><div class="schedule-info"><b>${escapeHtml(block.title)}</b><span>${escapeHtml(block.detail)}</span>${tasks}</div></div>`;
  }

  async function generateQuiz(subject, topic, level, mode, count = 4, difficulty = '') {
    try {
      const response = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, topic, level, mode, count, difficulty }),
      });
      const result = await response.json();
      if (result.success && result.data?.questions?.length) return { title: `${topic} 小测验`, questions: result.data.questions, fromAI: true };
      return { title: `${topic} 小测验`, fromAI: false, questions: [], fallbackReason: result.error || '接口没有返回题目数据' };
    } catch (error) {
      return { title: `${topic} 小测验`, fromAI: false, questions: [], fallbackReason: error.message || '网络请求失败' };
    }
  }

  function renderQuizCard(quiz) {
    const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    const body = questions.length ? questions.map((q, index) => `<div class="quiz-question" data-index="${index}"><p>${index + 1}. ${escapeHtml(q.question)}</p><div class="quiz-options">${q.options.map(option => { const letter = option[0]; return `<button class="quiz-option" data-letter="${letter}" onclick="selectQuizAnswer(${index}, '${letter}', this)">${escapeHtml(option)}</button>`; }).join('')}</div><div class="quiz-feedback"></div></div>`).join('') : '<p class="quiz-empty">当前未检测到可用的大模型密钥或出题服务不可用，暂时无法生成学科题目。接入大模型后可解锁更贴合模块与学段的练习。</p>';
    const submit = questions.length ? '<button onclick="submitStudyQuiz(this)">提交答案并生成复习计划</button>' : '';
    const actions = questions.length
      ? `<button class="ghost" onclick="retryAiQuiz()">重新用 DeepSeek 出题</button><button class="ghost" onclick="generateReviewPlan([])">直接生成模块计划</button>`
      : `<button class="ghost" onclick="openAiSetup()"><i class="fas fa-plug"></i> 接入大模型</button>`;
    return `<div class="study-quiz-card active-quiz-card"><div class="quiz-card-head"><span>${flow.mode === 'quiz-review' ? '诊断练习' : '配套练习'}</span><strong>${escapeHtml(quiz.title)}</strong></div>${body}<div class="card-actions">${submit}${actions}</div></div>`;
  }

  window.retryAiQuiz = async function () {
    if (!flow.subject || !flow.topic) return;
    UI.addUserMessage('重新用 DeepSeek 出题');
    flow.answers = {};
    await showQuizFromAI('练习题');
  };

  window.selectQuizAnswer = function (index, letter, button) {
    const question = flow.quiz?.questions?.[index];
    const questionEl = button.closest('.quiz-question');
    if (!question || !questionEl || questionEl.dataset.answered === 'true') return;
    flow.answers[index] = letter;
    questionEl.dataset.answered = 'true';
    questionEl.querySelectorAll('.quiz-option').forEach(option => {
      const optionLetter = option.dataset.letter;
      option.disabled = true;
      option.classList.remove('selected');
      if (optionLetter === question.answer) option.classList.add('correct');
      if (optionLetter === letter && letter !== question.answer) option.classList.add('wrong');
    });
    const feedback = questionEl.querySelector('.quiz-feedback');
    feedback.innerHTML = letter === question.answer
      ? `<span class="feedback-ok">回答正确：${escapeHtml(question.explanation)}</span>`
      : `<span class="feedback-bad">回答错误。正确答案是 ${question.answer}。${escapeHtml(question.explanation)}</span>`;
    UI.typesetMath(feedback);
  };

  window.submitStudyQuiz = async function (submitButton) {
    if (!flow.quiz) return;
    const quizCard = submitButton?.closest('.study-quiz-card') || document.querySelector('.study-quiz-card.active-quiz-card');
    if (!quizCard || quizCard.classList.contains('archived-quiz-card')) return;
    const wrong = [];
    const attemptQuestions = [];
    flow.quiz.questions.forEach((question, index) => {
      const selected = flow.answers[index];
      const questionEl = quizCard.querySelector(`.quiz-question[data-index="${index}"]`);
      const feedback = questionEl?.querySelector('.quiz-feedback');
      if (!questionEl || !feedback) return;
      questionEl.querySelectorAll('.quiz-option').forEach(option => {
        const letter = option.dataset.letter;
        option.disabled = true;
        if (letter === question.answer) option.classList.add('correct');
        if (selected === letter && selected !== question.answer) option.classList.add('wrong');
      });
      const attempt = { ...question, selected: selected || '', isWrong: selected !== question.answer };
      attemptQuestions.push(attempt);
      if (attempt.isWrong) wrong.push(attempt);
      feedback.innerHTML = selected === question.answer ? `<span class="feedback-ok">回答正确：${escapeHtml(question.explanation)}</span>` : `<span class="feedback-bad">正确答案是 ${question.answer}。${escapeHtml(question.explanation)}</span>`;
      UI.typesetMath(feedback);
    });
    flow.quizSubmitted = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = '答案已提交';
    }
    const savedCount = Tools.addWrongQuestions(wrong, { subject: flow.subject, topic: flow.topic, level: flow.level });
    if (savedCount) showToast(`已加入错题集 ${savedCount} 道`, 'success');
    if (!wrong.length) {
      UI.addAgentMessage('这套题全部答对了。我先不塞给你固定复习表，建议直接进入下一模块，或者换一组更高难度的诊断题。', { quickReplies: ['重新用 DeepSeek 出题', '开始学习', '今日总结'] });
      return;
    }
    UI.showTypingIndicator();
    try {
      const stored = await saveQuizAttempt(attemptQuestions);
      const review = await generateAiReview(stored.wrongQuestions?.length ? stored.wrongQuestions : wrong);
      flow.reviewId = review.reviewId;
      flow.reviewPlans = review.plans;
      UI.removeTypingIndicator();
      UI.addAgentMessage('我已根据本次真实错题完成错因分析。先选一种复习方案，之后我再按你的时间生成具体安排。', { customHTML: renderAiReviewCard(review) });
    } catch (error) {
      UI.removeTypingIndicator();
      UI.addAgentMessage(`错题已保存，但 AI 复盘暂时未完成：${error.message || '请稍后重试'}。`, { quickReplies: ['重新用 DeepSeek 出题', '开始学习'] });
    }
  };

  async function saveQuizAttempt(questions) {
    const response = await fetch('/api/learning/quiz-attempt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: flow.subject, topic: flow.topic, level: flow.level, questions }) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || '答题记录保存失败');
    return result.data;
  }

  async function generateAiReview(wrongQuestions) {
    const response = await fetch('/api/review-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: flow.subject, topic: flow.topic, level: flow.level, wrongQuestions }) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'AI 错因分析失败');
    return result.data;
  }

  function renderAiReviewCard(review) {
    const weaknesses = review.analysis.keyWeaknesses?.length ? `<div class="weak-list">${review.analysis.keyWeaknesses.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : '';
    return `<div class="ai-review-card"><div class="review-stage"><span>01 · AI 错因分析</span><strong>${escapeHtml(flow.subject)} · ${escapeHtml(flow.topic)}</strong><p>${escapeHtml(review.analysis.summary)}</p>${weaknesses}</div><div class="review-stage"><span>02 · 选择复习方案</span><strong>根据你的错题给出 ${review.plans.length} 种路径</strong><div class="review-options">${review.plans.map(plan => `<button class="review-option" onclick="selectAiReviewPlan('${escapeHtml(review.reviewId)}','${escapeHtml(plan.id)}')"><b>${escapeHtml(plan.title)}</b><small>${escapeHtml(plan.fit)}</small><p>${escapeHtml(plan.why)}</p><ul>${plan.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ul><em>选择此方案 <i class="fas fa-arrow-right"></i></em></button>`).join('')}</div></div></div>`;
  }

  window.selectAiReviewPlan = async function (reviewId, planId) {
    UI.addUserMessage('选择复习方案');
    UI.showTypingIndicator();
    try {
      const response = await fetch('/api/review-schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId, planId, availableMinutes: flow.minutes || 45 }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '时间安排生成失败');
      UI.removeTypingIndicator();
      const blocks = withScheduleTimes(result.data.blocks);
      UI.addAgentMessage('03 · 已按你选定的方案生成具体复习时间安排。', { customHTML: renderReviewPlanCard([], { total: result.data.total, weakPoints: [], blocks }, 'AI 针对性复习安排') });
      persistPlan('AI 针对性复习安排', { total: result.data.total, weakPoints: [], blocks });
    } catch (error) {
      UI.removeTypingIndicator();
      UI.addAgentMessage(`时间安排暂时没有生成：${error.message || '请重试'}`);
    }
  };

  function withScheduleTimes(blocks) {
    const start = new Date();
    let used = 0;
    return blocks.map(block => {
      const from = new Date(start.getTime() + used * 60000);
      used += block.duration;
      const to = new Date(start.getTime() + used * 60000);
      return { ...block, time: `${timeText(from)}-${timeText(to)}`, type: 'review' };
    });
  }

  window.clearWrongBook = function () {
    Tools.clearWrongQuestions();
    UI.addAgentMessage('错题集已经清空。之后新的错题会继续自动收集。', { quickReplies: ['开始学习', '今日总结', '看统计'] });
  };

  window.generateReviewPlan = function (wrongQuestions = []) {
    const plan = buildReviewPlan(wrongQuestions, { mode: 'direct' });
    UI.addAgentMessage('已生成按时间推进的模块复习计划。', { customHTML: renderReviewPlanCard(wrongQuestions, plan, '直接复习计划') });
    persistPlan('直接复习计划', plan);
  };

  function getModuleReviewPoints(subject, topic, level) {
    if (subject === '数学') return [`${level || ''}${topic}核心概念`, `${topic}典型题型`, `${topic}易错条件`].map(item => item.trim());
    if (subject === '数据结构') return [`${topic}基本操作`, `${topic}复杂度分析`, `${topic}边界情况`];
    return [`${topic}核心概念`, `${topic}典型例题`, `${topic}易错点`];
  }

  function renderRecentSection(items, handler) {
    if (!items.length) return '';
    return `<div class="card-section recent-section"><div class="section-title">最近自定义</div><div class="choice-grid compact">${items.slice(0, 3).map(item => compactChoiceButton(item, handler)).join('')}</div></div>`;
  }

  function choiceButton(label, handler) { return `<button class="choice-card" onclick="${handler}('${encodeChoice(label)}')">${escapeHtml(label)}</button>`; }
  function compactChoiceButton(label, handler) { return `<button class="choice-card compact-choice" onclick="${handler}('${encodeChoice(label)}')"><i class="${subjectIcon(label)}"></i><span>${escapeHtml(label)}</span></button>`; }
  function subjectChoiceButton(label) { return `<button class="choice-card subject-choice" onclick="selectStudySubject('${encodeChoice(label)}')"><i class="${subjectIcon(label)}"></i><strong>${escapeHtml(label)}</strong><span>${escapeHtml(subjectDescription(label))}</span></button>`; }
  function subjectIcon(label) {
    if (/数学|线性代数|函数/.test(label)) return 'fas fa-square-root-variable';
    if (/英语|四级|单词/.test(label)) return 'fas fa-language';
    if (/编程|代码|算法|数据结构/.test(label)) return 'fas fa-code';
    if (/物理/.test(label)) return 'fas fa-atom';
    if (/化学/.test(label)) return 'fas fa-flask';
    return 'fas fa-book-open';
  }
  function subjectDescription(label) {
    const map = {
      数据结构: '梳理概念、复杂度和典型题',
      数学: '概念、公式、例题逐步推进',
      英语: '词汇、阅读、听力按目标拆解',
      编程: '语法、项目和调试一起练',
      物理: '模型、公式和题型联动复习',
      化学: '方程式、实验和计算专项巩固',
    };
    return map[label] || '按你的目标生成专属计划';
  }
  function timeButton(minutes) { return `<button class="choice-card" onclick="selectStudyDuration(${Number(minutes)})">${formatMinutes(Number(minutes))}</button>`; }
  function needsLevel(subject) { return Boolean(flow.aiOptions?.levels?.length || levelPresets[subject]); }
  function hasTopicChoices(subject) { return Boolean(flow.aiOptions?.topics?.length || topicPresets[subject]?.length); }
  function getRecentSubjects() { return Tools.loadSetting('recentSubjects', ['数据结构', '数学', '英语四级']).slice(0, 3); }
  function getRecentTopics(subject) { return Tools.loadSetting(getTopicRecentKey(subject), []).slice(0, 3); }
  function getRecentTimes() { return Tools.loadSetting('recentTimes', [35, 50, 75]).slice(0, 3); }
  function getTopicRecentKey(subject) { return `recentTopics_${subject || 'default'}`; }
  function saveRecent(key, value) { const normalized = typeof value === 'number' ? value : String(value).trim(); const current = Tools.loadSetting(key, []); Tools.saveSetting(key, [normalized, ...current.filter(item => String(item) !== String(normalized))].slice(0, 3)); }
  function encodeChoice(value) { return encodeURIComponent(String(value)); }
  function decodeChoice(value) { return decodeURIComponent(String(value)); }
  function timeText(date) { return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
  function levelText() { return flow.level ? `${flow.level} ` : ''; }
  function formatMinutes(minutes) { if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} 小时`; if (minutes > 60) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`; return `${minutes} 分钟`; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function handleStudyIntent(text) {
    if (/继续学习/.test(text) && !XiaoZhi.getState().sessionActive) XiaoZhi.startSession();
    if (/结束学习|今天到这|不学了/.test(text)) {
      XiaoZhi.stopSession();
      UI.renderAnalytics();
    }
  }
  function getQuickReplies(text, actions) { const actionReplies = actions?.find(action => action.type === 'quickReply')?.options; if (actionReplies?.length) return actionReplies; if (/总结|复盘/.test(text)) return ['开始学习', '看统计', '休息 5 分钟']; if (/累|困|休息/.test(text)) return ['休息 5 分钟', '开始学习', '今日总结']; return ['开始学习', '拍照解题', '今日总结']; }

  window.quickAction = function (action) { if (action === 'startStudy') { UI.addUserMessage('开始学习'); startStudyFlow(); return; } if (action === 'timer') return Tools.openTool('timer'); if (action === 'photo') return triggerPhotoUpload(); if (action === 'goals') { UI.addUserMessage('设定学习目标'); startStudyFlow(); return; } if (action === 'wrongbook') { UI.addUserMessage('打开错题集'); Tools.openTool('wrongbook'); return; } if (action === 'dailySummary') { UI.addUserMessage('今日总结'); Tools.openTool('summary'); return; } const messages = { takeBreak: '我想休息一下' }; const text = messages[action]; if (!text) return; document.getElementById('chatInput').value = text; sendMessage(); };
  window.handleQuickReply = function (text) { if (text === '开始学习' || text === '设定目标' || text === '设定明日目标') { UI.addUserMessage(text); startStudyFlow(); return; } if (text === '看统计') return switchPage('analytics'); if (text === '拍照解题') return triggerPhotoUpload(); document.getElementById('chatInput').value = text; sendMessage(); };
  window.handleKeyPress = function (event) { if (event.key === 'Enter') { event.preventDefault(); sendMessage(); } };
  window.triggerPhotoUpload = function () { document.getElementById('photoInput').click(); };
  window.handlePhotoUpload = async function (event) { const file = event.target.files[0]; if (!file) return; const photo = await Tools.handlePhotoUpload(file); UI.addUserMessage('我上传了一张题目图片', { imageUrl: photo.dataUrl }); UI.showTypingIndicator(); const response = await XiaoZhi.generatePhotoResponse(photo.name); UI.removeTypingIndicator(); UI.addAgentMessage(response.text, { quickReplies: ['我来输入题目', '开始学习', '看统计'] }); UI.renderAnalytics(); event.target.value = ''; };
  window.showSettings = function () { const state = XiaoZhi.getState(); document.getElementById('settingName').value = state.userName === '同学' ? '' : state.userName; document.getElementById('settingSubject').value = state.subject === '学习' ? '' : state.subject; document.getElementById('settingGoal').value = state.dailyGoal; document.getElementById('settingBreakInterval').value = state.breakInterval; UI.showModal('settingsModal'); };
  window.saveSettings = function () { const name = document.getElementById('settingName').value.trim(); const subject = document.getElementById('settingSubject').value.trim(); const goal = Number(document.getElementById('settingGoal').value) || 120; const breakInterval = Number(document.getElementById('settingBreakInterval').value) || 45; XiaoZhi.setUserName(name || '同学'); XiaoZhi.setSubject(subject || '学习'); XiaoZhi.setDailyGoal(goal); XiaoZhi.setBreakInterval(breakInterval); document.getElementById('profileName').textContent = name || '同学'; Tools.saveSetting('userName', name || '同学'); Tools.saveSetting('subject', subject || '学习'); Tools.saveSetting('dailyGoal', goal); Tools.saveSetting('breakInterval', breakInterval); UI.closeModal('settingsModal'); showToast('设置已保存', 'success'); };
  function loadSettings() { const name = Tools.loadSetting('userName', '同学'); const subject = Tools.loadSetting('subject', '学习'); const goal = Tools.loadSetting('dailyGoal', 120); const breakInterval = Tools.loadSetting('breakInterval', 45); XiaoZhi.setUserName(name); XiaoZhi.setSubject(subject); XiaoZhi.setDailyGoal(goal); XiaoZhi.setBreakInterval(breakInterval); document.getElementById('profileName').textContent = name; UI.renderAnalytics(); }

  window.openAiSetup = function () {
    const hasKey = document.getElementById('apiStatusBadge').classList.contains('connected');
    switchAiSetup(hasKey ? 'success' : 'input');
    document.getElementById('aiSetupKey').value = '';
    UI.showModal('aiSetupModal');
    if (!hasKey) setTimeout(() => document.getElementById('aiSetupKey').focus(), 50);
  };
  window.switchAiSetup = function (view) {
    const inputView = document.getElementById('aiSetupInputView');
    const successView = document.getElementById('aiSetupSuccessView');
    if (view === 'success') {
      inputView.hidden = true;
      successView.hidden = false;
    } else {
      inputView.hidden = false;
      successView.hidden = true;
      clearAiSetupError();
    }
  };
  window.closeAiSetupSuccess = function () {
    UI.closeModal('aiSetupModal');
    updateApiStatus(true);
    showToast('大模型已接入，全部学习能力已解锁', 'success');
  };
  window.skipAiSetup = async function () {
    UI.closeModal('aiSetupModal');
    try {
      await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: '' }) });
    } catch (_) { /* 忽略清空失败，仍回本地模式 */ }
    updateApiStatus(false);
    showToast('已切换至本地模式，可随时在右上角接入大模型', 'info');
  };
  window.connectDefaultAiKey = async function () {
    UI.showTypingIndicator();
    try {
      const res = await fetch('/api/config/test-key', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      UI.removeTypingIndicator();
      if (data.success) {
        XiaoZhi.checkApiStatus();
        updateApiStatus(true);
        switchAiSetup('success');
        if (data.valid === 'network') showToast('已接入演示密钥，但当前网络可能不通，对话时如失败请检查网络', 'info');
      } else {
        showAiSetupError(data.error || '未检测到可用的演示密钥');
      }
    } catch (_) {
      UI.removeTypingIndicator();
      showAiSetupError('接入失败，请确认服务已启动后重试');
    }
  };
  window.connectAiKey = async function () {
    const input = document.getElementById('aiSetupKey');
    const key = input.value.trim();
    if (!key) { showToast('请输入 DeepSeek API Key', 'warning'); return; }
    if (!/^sk-/.test(key)) { showAiSetupError('密钥格式不正确，应以 sk- 开头'); return; }
    try {
      const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key }) });
      const data = await res.json();
      if (data.success) {
        XiaoZhi.checkApiStatus();
        updateApiStatus(true);
        switchAiSetup('success');
        if (data.valid === 'network') {
          showToast('大模型密钥已保存，但当前网络可能不通，对话时如失败请检查网络', 'info');
        }
      } else {
        showAiSetupError(data.error || '密钥无效，请确认后重新输入');
      }
    } catch (_) {
      showAiSetupError('接入失败，请确认服务已启动后重试');
    }
  };
  function showAiSetupError(message) {
    const input = document.getElementById('aiSetupKey');
    const err = document.getElementById('aiSetupError');
    input.classList.add('input-error');
    err.textContent = message || '密钥无效或格式不正确，请重新输入';
    err.hidden = false;
  }
  window.clearAiSetupError = function () {
    const input = document.getElementById('aiSetupKey');
    const err = document.getElementById('aiSetupError');
    input.classList.remove('input-error');
    if (err) err.hidden = true;
  };
  function updateApiStatus(hasKey) {
    const badge = document.getElementById('apiStatusBadge');
    const text = document.getElementById('apiStatusText');
    if (hasKey === undefined) hasKey = Boolean(badge.dataset.hasKey === 'true' || text.dataset.hasKey === 'true');
    badge.classList.toggle('connected', !!hasKey);
    text.textContent = hasKey ? '大模型已接入' : '未接入';
    text.dataset.hasKey = hasKey ? 'true' : 'false';
  }
  async function refreshApiStatus() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      const hasKey = !!(data && data.hasApiKey);
      updateApiStatus(hasKey);
      if (!hasKey && !localStorage.getItem('xiaozhi_ai_setup_shown')) {
        localStorage.setItem('xiaozhi_ai_setup_shown', '1');
        UI.showModal('aiSetupModal');
      }
      return hasKey;
    } catch (_) {
      updateApiStatus(false);
      return false;
    }
  }
  window.refreshApiStatus = refreshApiStatus;
  window.toggleTimer = function () { Tools.toggleTimer(); };
  window.resetTimer = function () { Tools.resetTimer(); };
  window.setTimerPreset = function (minutes) { Tools.setTimerPreset(minutes); };
  window.openTool = function (name) { Tools.openTool(name); };
  let voiceActive = false;
  window.toggleVoice = function () { voiceActive = !voiceActive; const btn = document.getElementById('voiceBtn'); btn.style.color = voiceActive ? 'var(--brand-600)' : ''; if (voiceActive) { showToast('语音输入演示已开启', 'info'); setTimeout(() => { document.getElementById('chatInput').value = '我想学习高中数学函数'; voiceActive = false; btn.style.color = ''; showToast('已填入语音识别示例', 'success'); }, 1200); } };
  window.onStudySessionComplete = function (minutes) { UI.addAgentMessage(`完成 ${minutes} 分钟专注学习，做得不错。要不要休息一下再继续？`, { quickReplies: ['休息 5 分钟', '开始学习', '看统计'] }); };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.modal.active').forEach(modal => modal.classList.remove('active')); });
})();
