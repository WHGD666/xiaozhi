/* 计划列表页：把对话中 AI 生成的学习计划收进来，紧凑展示，点击展开完整长卡片。 */
const DEMO_PLANS = [
  {
    id: 'demo-1',
    title: '直接复习计划',
    type: 'review',
    subject: '物理',
    level: '高中物理',
    topic: '力学',
    minutes: 90,
    weakPoints: ['力学核心概念', '力学典型例题', '力学易错点'],
    blocks: [
      { time: '19:41-20:06', duration: 25, title: '模块回顾', detail: '快速回顾 力学 的关键概念。', type: 'review', tasks: ['翻看 力学 的核心概念和例题标题。', '不看答案，先说出每个概念的使用场景。', '圈出 1 个最容易混淆的点。'] },
      { time: '20:06-20:35', duration: 29, title: '重点巩固', detail: '围绕 力学核心概念 做主动回忆。', type: 'review', tasks: ['合上资料，默写 力学核心概念 的判断方法。', '对照笔记补掉遗漏的条件。', '写一个自己的例子验证是否理解。'] },
      { time: '20:35-20:58', duration: 23, title: '轻量练习', detail: '做 1-2 道代表题保持手感。', type: 'practice', tasks: ['完成 1-2 道代表题或阅读练习。', '重点检查步骤是否完整。', '把不确定的地方标为下一次问题。'] },
      { time: '20:58-21:11', duration: 13, title: '复盘收束', detail: '整理本模块的易错提醒。', type: 'review', tasks: ['总结 力学 的 3 条易错提醒。', '记录今天完成了什么、还差什么。', '给下一次学习设一个 10 分钟启动任务。'] },
    ],
  },
  {
    id: 'demo-2',
    title: '学习计划',
    type: 'learning',
    subject: '数学',
    level: '高三',
    topic: '函数',
    minutes: 60,
    weakPoints: [],
    blocks: [
      { time: '08:00-08:08', duration: 8, title: '预热复习', detail: '回顾 函数 的前置知识和易错点。', type: 'review', tasks: ['快速翻看 函数 上一次的笔记或错题。', '把已经会的内容打勾，把模糊点单独列出来。', '选出今天最需要补的一处薄弱点。'] },
      { time: '08:08-08:30', duration: 22, title: '核心学习', detail: '系统学习 函数 的定义、方法和例题。', type: 'study', tasks: ['按“概念-步骤-例题”学习 函数。', '每学完一个小点，立刻用自己的话写一句解释。', '把例题步骤拆成 3-5 个动作，特别标出容易错的条件。'] },
      { time: '08:30-08:35', duration: 5, title: '短休息', detail: '离开屏幕，活动一下。', type: 'break', tasks: ['离开座位，活动肩颈和手腕。', '喝水，眼睛看远处 30 秒。', '回来后只看刚才标出的薄弱点继续。'] },
      { time: '08:35-09:12', duration: 37, title: '练习巩固', detail: '完成典型题，记录卡住的位置。', type: 'practice', tasks: ['完成 2-3 道 函数 典型题。', '每题先写思路，再写步骤，最后对答案。', '错题只记录错因，不抄整段答案。'] },
      { time: '09:12-09:20', duration: 8, title: '收束复盘', detail: '整理今天最重要的 3 条结论。', type: 'review', tasks: ['写下今天掌握的 3 个关键词。', '把错题归类为概念不清、步骤遗漏或审题问题。', '给下一次学习留下一个明确入口。'] },
    ],
  },
  {
    id: 'demo-3',
    title: 'AI 针对性复习安排',
    type: 'ai',
    subject: '编程',
    level: '大学',
    topic: '动态规划',
    minutes: 45,
    weakPoints: [],
    blocks: [
      { time: '20:00-20:18', duration: 18, title: '错因定位', detail: '重新定位动态规划状态转移不熟的点。', type: 'review', tasks: ['逐题回看错误选项，判断是概念、审题还是步骤问题。', '把薄弱点归并为：状态定义、转移方程、边界。', '每个薄弱点只写一句最核心的错因。'] },
      { time: '20:18-20:35', duration: 17, title: '针对复习', detail: '重点复习状态定义与转移方程。', type: 'review', tasks: ['重看 动态规划 的经典模型和模板。', '用自己的话写出判断方法，不直接背答案。', '整理 2 条下次做题前要检查的提醒。'] },
      { time: '20:35-20:42', duration: 7, title: '同类练习', detail: '做 2-3 道同类题观察是否还犯同样的错。', type: 'practice', tasks: ['先独立完成同类题，再看解析。', '每题对照刚才的提醒检查一遍。', '如果继续错，把错因追加到薄弱点后面。'] },
    ],
  },
];

let plansOpenedId = null;

function plansEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function plansFormatMinutes(minutes) {
  const min = Number(minutes) || 0;
  if (min >= 60 && min % 60 === 0) return `${min / 60} 小时`;
  if (min > 60) return `${Math.floor(min / 60)} 小时 ${min % 60} 分钟`;
  return `${min} 分钟`;
}

function plansCountLabel(plan) {
  const count = Array.isArray(plan.blocks) ? plan.blocks.length : 0;
  return `${count} 个时段`;
}

function plansTypeClass(type) {
  return 'tag-' + (type || 'review');
}

function plansDotLabel(type) {
  return { learning: '学习计划', review: '复习计划', ai: 'AI 安排' }[type] || '计划';
}

function plansHead(plan, opened) {
  const id = plansEscape(plan.id);
  const topic = plan.topic && plan.topic !== plan.subject ? ` · ${plansEscape(plan.topic)}` : '';
  return `<button class="plans-row" data-plan-id="${id}" onclick="expandPlans('${plansEscape(String(plan.id))}')"><span class="plans-type plans-type-${plansEscape(plan.type)}">${plansDotLabel(plan.type)}</span><span class="plans-row-title"><strong>${plansEscape(plan.title)}</strong><em>${plansEscape(plan.subject)}${plan.level ? ` · ${plansEscape(plan.level)}` : ''}${topic}</em></span><span class="plans-row-meta">${plansFormatMinutes(plan.minutes || plan.duration)}<b>${plansCountLabel(plan)}</b><i class="fas fa-chevron-${opened ? 'up' : 'down'} plans-arrow"></i></span></button>`;
}

function plansBody(plan) {
  const head =
    `<div class="plan-card-head"><div><span>计划详情</span><strong>${plansEscape(plan.title)} · ${plansEscape(plan.subject)}${plan.level ? ` · ${plansEscape(plan.level)}` : ''}${plan.topic ? ` · ${plansEscape(plan.topic)}` : ''}</strong></div><em>${plansFormatMinutes(plan.minutes || plan.duration)}</em></div>`;
  const weakList = Array.isArray(plan.weakPoints) && plan.weakPoints.length ? `<div class="weak-list">${plan.weakPoints.map(point => `<span>${plansEscape(point)}</span>`).join('')}</div>` : '';
  const rows = (Array.isArray(plan.blocks) ? plan.blocks : []).map(block => {
    const tasks = Array.isArray(block.tasks) && block.tasks.length ? `<ul class="schedule-tasks">${block.tasks.map(task => `<li>${plansEscape(task)}</li>`).join('')}</ul>` : '';
    return `<div class="schedule-row ${plansTypeClass(block.type)}"><div class="schedule-time">${plansEscape(block.time || '')}</div><div class="schedule-dot"></div><div class="schedule-info"><b>${plansEscape(block.title)}</b><span>${plansEscape(block.detail)}</span>${tasks}</div></div>`;
  }).join('');
  const cardClass = plan.type === 'learning' ? 'study-plan-card' : 'review-plan-card';
  return `<div class="${cardClass}">${head}${weakList}<div class="schedule-list">${rows}</div></div>`;
}

function plansFullCard(plan) {
  return `<div class="plans-card-open">${plansBody(plan)}</div>`;
}

function plansEmpty() {
  return `<div class="plans-empty"><i class="fas fa-list-check"></i><strong>还没有生成过学习计划</strong><p>在对话里走一次学习/复习（例如“我想学高中物理力学”），AI 生成的计划会收进这里，随时回看照着做。</p></div>`;
}

function renderPlans() {
  const container = document.getElementById('plansList');
  if (!container) return;
  const isDemo = window.StudyDataMode.isDemo();
  const plans = isDemo ? DEMO_PLANS : (window.Tools || Tools).getPlans();
  if (!isDemo && !plans.length) {
    container.innerHTML = plansEmpty();
    return;
  }
  container.innerHTML =
    (isDemo ? `<p class="plans-note"><i class="fas fa-wand-magic-sparkles"></i> 示例计划 · 在「学习工具 → 接入数据」里可查看你自己生成的计划</p>` : '') +
    plans.map(plan => `${plansHead(plan, plansOpenedId === String(plan.id))}${plansOpenedId === String(plan.id) ? plansFullCard(plan) : ''}`).join('');
}

function expandPlans(id) {
  plansOpenedId = plansOpenedId === String(id) ? null : String(id);
  renderPlans();
}

window.renderPlans = renderPlans;
window.expandPlans = expandPlans;