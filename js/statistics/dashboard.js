const StudyDashboard = (() => {
  let dashboardData = null;
  let activeRange = 7;
  let clockTimer = null;
  let resizeObserver = null;
  const charts = new Map();

  const formatHours = minutes => `${(minutes / 60).toFixed(1)} h`;
  const formatClock = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const dateLabel = date => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(date));

  function getRoot() { return document.getElementById('statisticsDashboard'); }

  function renderShell() {
    const root = getRoot();
    if (!root) return;
    root.innerHTML = `<div class="dashboard-backdrop"></div><header class="dashboard-header"><div class="dashboard-brand"><div class="dashboard-brand-mark"><i class="fas fa-robot"></i></div><div><span>AI LEARNING INTELLIGENCE</span><strong>小知 · 学习数据中心</strong></div></div><div class="dashboard-title"><span>STUDY DATA COMMAND CENTER</span><h1>学习数据可视化大屏</h1></div><div class="dashboard-actions"><div class="dashboard-live"><span id="dashboardDate"></span><b><i></i> ONLINE</b></div><button class="dashboard-head-btn" onclick="StudyDashboard.back()"><i class="fas fa-arrow-left"></i>返回统计</button><button class="dashboard-head-btn primary" onclick="StudyDashboard.toggleFullscreen()"><i class="fas fa-expand"></i>全屏显示</button></div></header><main class="dashboard-main" id="dashboardMain">${StatisticsDashboardComponents.stateView('loading', '正在汇总学习数据...')}</main>`;
  }

  function renderDashboard(data) {
    const root = document.getElementById('dashboardMain');
    if (!root) return;
    return renderDashboardCompact(data);
    const { overview, currentStatus, insights } = data;
    root.innerHTML = `<section class="dashboard-kpis">${StatisticsDashboardComponents.kpiCard('fa-clock', 'TODAY STUDY', formatClock(overview.todayStudyMinutes * 60), '今日学习时长', '12.5%')}${StatisticsDashboardComponents.kpiCard('fa-list-check', 'TASK PROGRESS', `${overview.completedTasks} / ${overview.totalTasks}`, '今日完成任务', '2 tasks')}${StatisticsDashboardComponents.kpiCard('fa-fire-flame-curved', 'STREAK', overview.streakDays, 'DAYS 连续学习', '3 days')}${StatisticsDashboardComponents.kpiCard('fa-bolt', 'FOCUS SCORE', overview.focusScore, '优秀专注指数', '5.8%')}${StatisticsDashboardComponents.kpiCard('fa-calendar-days', 'THIS MONTH', overview.monthlyStudyDays, '本月学习天数', '4 days')}</section><section class="dashboard-grid"><div class="dashboard-column dashboard-left">${StatisticsDashboardComponents.panel('学习时长趋势', 'STUDY TREND', '<div class="dashboard-range" id="trendRange"><button data-range="7" class="active">7天</button><button data-range="30">30天</button><button data-range="90">90天</button></div><div class="dashboard-chart trend-chart" id="trendChart"></div>', 'dashboard-trend-panel')}${StatisticsDashboardComponents.panel('学习时间分布', 'ACTIVE HOURS', '<div class="dashboard-chart compact-chart" id="timeChart"></div><p class="dashboard-caption">高效学习时间：<b>19:00 - 22:00</b></p>', 'dashboard-time-panel')}</div><div class="dashboard-column dashboard-center">${StatisticsDashboardComponents.panel('学习专注指数', 'FOCUS SCORE', '<div class="focus-layout"><div class="dashboard-chart gauge-chart" id="focusChart"></div><div><strong class="focus-score">86</strong><span>优秀</span><p>专注节奏稳定，适合保持当前学习强度。</p></div></div>', 'dashboard-focus-panel')}${StatisticsDashboardComponents.panel('学习活跃热力图', '90 DAYS ACTIVITY', '<div class="dashboard-chart heatmap-chart" id="heatmapChart"></div><p class="dashboard-caption">每个格子代表一天的学习投入</p>', 'dashboard-heatmap-panel')}</div><div class="dashboard-column dashboard-right">${StatisticsDashboardComponents.panel('学科投入分布', 'SUBJECT MIX', '<div class="dashboard-chart donut-chart" id="subjectChart"></div>', 'dashboard-subject-panel')}${renderCurrentStatus(currentStatus)}${renderInsights(insights)}</div></section>`;
    root.querySelector('.dashboard-right')?.insertAdjacentHTML('afterbegin', StatisticsDashboardComponents.panel('能力雷达', 'ABILITY PROFILE', '<div class="dashboard-chart radar-chart" id="abilityChart"></div>', 'dashboard-radar-panel'));
    bindInteractions();
    renderAllCharts(data);
    const legend = document.getElementById('subjectLegend');
    if (legend) legend.innerHTML = data.subjectDistribution.slice(0, 5).map((item, index) => `<div><i class="subject-color-${index}"></i><span>${item.subjectName}</span><b>${item.percentage}%</b></div>`).join('');
  }

  function renderDashboardCompact(data) {
    const root = document.getElementById('dashboardMain');
    const { overview, currentStatus, insights } = data;
    const hasLearningData = overview.weeklyStudyMinutes > 0 || overview.completedTasks > 0 || data.subjectDistribution.some(item => item.studyMinutes > 0);
    if (!hasLearningData) {
      root.innerHTML = StatisticsDashboardComponents.stateView('empty', '暂无可视化学习数据。完成一次有效学习并提交一套测验后，这里会基于本地真实记录生成趋势、错题与学习画像。');
      return;
    }
    const kpis = [
      ['今日学习', formatClock(overview.todayStudyMinutes * 60), '来自学习会话记录'],
      ['今日任务', `${overview.completedTasks} / ${overview.totalTasks}`, overview.totalTasks ? `${Math.round(overview.completedTasks / overview.totalTasks * 100)}% 完成` : '暂无测验记录'],
      ['连续学习', `${overview.streakDays} 天`, '持续记录中'],
      ['专注指数', overview.focusScore || '--', overview.focusScore ? '基于答题正确率' : '暂无测验记录'],
      ['本月学习', `${overview.monthlyStudyDays} 天`, '来自学习会话记录'],
    ];
    const panel = (title, tag, body) => `<section class="dashboard-panel compact-panel"><header><div><h3>${title}</h3><span>${tag}</span></div></header>${body}</section>`;
    root.innerHTML = `<section class="dashboard-kpi-band">${kpis.map(item => `<article><span>${item[0]}</span><strong>${item[1]}</strong><em>${item[2]}</em></article>`).join('')}</section><section class="dashboard-grid compact-grid"><aside class="dashboard-side dashboard-left">${panel('能力画像', 'ABILITY', '<div class="dashboard-chart radar-chart" id="abilityChart"></div>')}${panel('学习时段', 'ACTIVE HOURS', '<div class="dashboard-chart compact-time-chart" id="timeChart"></div><p class="dashboard-conclusion">高效学习时段 <b>19:00 - 22:00</b></p>')}</aside><section class="dashboard-center-stage"><section class="trend-stage"><header class="trend-stage-head"><div><h2>学习趋势</h2><span>STUDY TREND</span></div><div class="trend-head-right"><div class="dashboard-range" id="trendRange"><button data-range="7" class="active">7天</button><button data-range="30">30天</button><button data-range="90">90天</button></div><div class="trend-total"><small>本周学习</small><strong>${formatHours(overview.weeklyStudyMinutes)}</strong><em>来自本地记录</em></div></div></header><div class="dashboard-chart compact-trend-chart" id="trendChart"></div><footer class="trend-support"><div class="focus-mini"><div class="dashboard-chart compact-focus-chart" id="focusChart"></div><div><span>专注指数</span><strong>${overview.focusScore}</strong><em>优秀</em></div></div><div class="support-stat"><span>今日完成</span><strong>${overview.completedTasks} / ${overview.totalTasks}</strong><em>${Math.round(overview.completedTasks / overview.totalTasks * 100)}% 已完成</em></div><div class="support-status"><span><i></i>${currentStatus.status}</span><strong>${currentStatus.task}</strong><em>已学习 ${formatClock(currentStatus.elapsedSeconds)}</em></div></footer></section></section><aside class="dashboard-side dashboard-right">${panel('科目投入分布', 'SUBJECT MIX', '<div class="subject-layout"><div class="dashboard-chart compact-donut-chart" id="subjectChart"></div><div class="subject-legend" id="subjectLegend"></div></div>')}${panel('90 天活跃度', 'ACTIVITY', `<div class="activity-summary"><span>连续学习 <b>${overview.streakDays} 天</b></span><span>近 90 天活跃 <b>63 天</b></span></div><div class="dashboard-chart compact-heatmap-chart" id="heatmapChart"></div>`)}</aside></section><footer class="dashboard-insight-bar"><div><i class="fas fa-wand-magic-sparkles"></i><span>AI INSIGHT</span></div><p>${insights.map(item => `<b>${item.title}</b> ${item.description}`).join('<i>·</i>')}</p></footer>`;
    const activeDays = data.heatmap.filter(item => item.studyMinutes > 0).length;
    const trendNote = root.querySelector('.trend-total em');
    if (trendNote) trendNote.textContent = '来自本地记录';
    const timeConclusion = root.querySelector('.dashboard-conclusion b');
    if (timeConclusion) timeConclusion.textContent = '基于实际会话累计';
    const activityDays = root.querySelector('.activity-summary span:last-child b');
    if (activityDays) activityDays.textContent = `${activeDays} 天`;
    const supportProgress = root.querySelector('.support-stat em');
    if (supportProgress) supportProgress.textContent = overview.totalTasks ? `${Math.round(overview.completedTasks / overview.totalTasks * 100)}% 已完成` : '暂无测验记录';
    bindInteractions();
    renderAllCharts(data);
  }

  function renderCurrentStatus(status) {
    return `<section class="dashboard-panel dashboard-status-panel"><div class="dashboard-panel-head"><div><span>CURRENT STATUS</span><h3>当前学习状态</h3></div><i class="fas fa-satellite-dish"></i></div><div class="status-live"><i></i>${status.status}</div><strong>${status.task}</strong><div class="status-row"><span>已学习</span><b>${formatClock(status.elapsedSeconds)}</b></div><div class="status-row"><span>今日目标</span><b>${formatClock(status.goalSeconds)}</b></div><div class="status-progress"><span style="width:${status.progress}%"></span></div><div class="status-foot"><span>完成度</span><b>${status.progress}%</b></div></section>`;
  }

  function renderInsights(insights) {
    return `<section class="dashboard-panel dashboard-insight-panel"><div class="dashboard-panel-head"><div><span>AI INSIGHT</span><h3>AI 学习洞察</h3></div><i class="fas fa-wand-magic-sparkles"></i></div><div class="insight-list">${insights.map(item => `<article><i class="fas ${item.type === 'growth' ? 'fa-arrow-trend-up' : item.type === 'time' ? 'fa-clock' : 'fa-lightbulb'}"></i><div><strong>${item.title}</strong><p>${item.description}</p></div></article>`).join('')}</div></section>`;
  }

  function baseChartOption() {
    return { backgroundColor: 'transparent', animationDuration: 700, textStyle: { fontFamily: 'Inter, Segoe UI, Microsoft YaHei, sans-serif' } };
  }

  function setChart(id, option) {
    const node = document.getElementById(id);
    if (!node || !window.echarts) return;
    const existing = charts.get(id);
    const instance = existing || window.echarts.init(node, null, { renderer: 'canvas' });
    charts.set(id, instance);
    instance.setOption({ ...baseChartOption(), ...option }, true);
  }

  function renderAllCharts(data) {
    const trend = StatisticsService.getTrend(data, activeRange);
    setChart('trendChart', {
      grid: { left: 8, right: 10, top: 26, bottom: 20, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(5,14,28,.94)', borderColor: 'rgba(89,190,255,.28)', textStyle: { color: '#e5f0ff' }, formatter: params => `${params[0].axisValue}<br/>学习时长：<b>${formatHours(params[0].data)}</b>` },
      xAxis: { type: 'category', boundaryGap: false, data: trend.map(item => dateLabel(item.date)), axisLine: { lineStyle: { color: 'rgba(121,154,192,.24)' } }, axisTick: { show: false }, axisLabel: { color: '#8294ac', fontSize: 10 } },
      yAxis: { type: 'value', splitNumber: 3, axisLabel: { color: '#8294ac', formatter: value => `${(value / 60).toFixed(1)}h` }, splitLine: { lineStyle: { color: 'rgba(110,151,205,.12)' } } },
      series: [{ type: 'line', smooth: true, data: trend.map(item => item.studyMinutes), symbol: 'circle', symbolSize: 6, lineStyle: { width: 3, color: '#38bdf8' }, itemStyle: { color: '#67e8f9', borderColor: '#07111f', borderWidth: 2 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(59,130,246,.45)' }, { offset: 1, color: 'rgba(59,130,246,.02)' }]) } }],
    });
    setChart('subjectChart', {
      tooltip: { trigger: 'item', backgroundColor: 'rgba(5,14,28,.94)', borderColor: 'rgba(89,190,255,.28)', textStyle: { color: '#e5f0ff' }, formatter: item => `${item.name}<br/>${formatHours(item.value)} · ${item.percent}%` },
      color: ['#38bdf8', '#6366f1', '#2dd4bf', '#60a5fa', '#a78bfa', '#54708f'],
      graphic: [{ type: 'text', left: 'center', top: '42%', style: { text: `TOTAL\n${formatHours(data.overview.weeklyStudyMinutes)}`, textAlign: 'center', fill: '#e5f0ff', font: '700 16px Inter' } }],
      series: [{ type: 'pie', radius: ['58%', '76%'], center: ['50%', '50%'], itemStyle: { borderColor: '#0a1728', borderWidth: 3, borderRadius: 6 }, label: { show: false }, labelLine: { show: false }, data: data.subjectDistribution.map(item => ({ name: item.subjectName, value: item.studyMinutes, percent: item.percentage })), emphasis: { scale: true, scaleSize: 4 } }],
    });
    setChart('focusChart', {
      series: [{ type: 'gauge', startAngle: 205, endAngle: -25, min: 0, max: 100, radius: '96%', progress: { show: true, width: 8, roundCap: true, itemStyle: { color: '#3bc5ef' } }, axisLine: { lineStyle: { width: 8, color: [[1, 'rgba(103,131,168,.16)']] } }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, detail: { show: false }, title: { show: false }, data: [{ value: data.overview.focusScore }] }],
    });
    const start = new Date(data.heatmap[0].date);
    const end = new Date(data.heatmap[data.heatmap.length - 1].date);
    const heatMax = Math.max(60, ...data.heatmap.map(item => item.studyMinutes));
    setChart('heatmapChart', {
      tooltip: { position: 'top', backgroundColor: 'rgba(4,10,22,.94)', borderColor: 'rgba(96,165,250,.32)', textStyle: { color: '#cfe8ff' }, extraCssText: 'border-radius:6px;padding:7px 10px;font-weight:500;box-shadow:0 4px 18px rgba(2,8,20,.55)', formatter: item => `${item.data[0]}<br/>学习 ${item.data[1]} 分钟<br/>完成任务 ${item.data[2]}` },
      visualMap: { min: 0, max: heatMax, show: false, calculable: false, inRange: { color: ['#163475', '#1d4f9c', '#2160d1', '#4290ff', '#82c1ff'] } },
      calendar: { top: 12, left: 34, right: 18, bottom: 6, range: [start, end], cellSize: ['auto', 13], splitLine: { show: false }, itemStyle: { borderWidth: 4, borderColor: '#0b1322', color: '#0c1426', borderRadius: 6 }, dayLabel: { color: '#b4d8f7', fontSize: 9, fontWeight: 300, fontFamily: 'Inter, Segoe UI, Microsoft YaHei, sans-serif' }, monthLabel: { color: '#b4d8f7', fontSize: 10, fontWeight: 300, fontFamily: 'Inter, Segoe UI, "Microsoft YaHei", sans-serif' }, yearLabel: { show: false } },
      series: [{ type: 'heatmap', coordinateSystem: 'calendar', itemStyle: { borderRadius: 6, borderWidth: 0 }, emphasis: { itemStyle: { color: '#a5d3ff', borderWidth: 0, borderRadius: 6, shadowBlur: 10, shadowColor: 'rgba(130,193,255,.5)' } }, data: data.heatmap.map(item => [item.date, item.studyMinutes, item.completedTasks]) }],
    });
    setChart('timeChart', {
      grid: { left: 2, right: 4, top: 12, bottom: 20, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(5,14,28,.94)', borderColor: 'rgba(89,190,255,.28)', textStyle: { color: '#e5f0ff' } },
      xAxis: { type: 'category', data: data.timeDistribution.map(item => `${String(item.hour).padStart(2, '0')}:00`), axisLabel: { color: '#8294ac', fontSize: 9 }, axisTick: { show: false }, axisLine: { lineStyle: { color: 'rgba(121,154,192,.22)' } } },
      yAxis: { type: 'value', show: false },
      series: [{ type: 'bar', data: data.timeDistribution.map(item => item.studyMinutes), barMaxWidth: 18, itemStyle: { borderRadius: [5, 5, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#5eead4' }, { offset: 1, color: '#3b82f6' }]) } }],
    });
    if (data.ability.length) setChart('abilityChart', {
      radar: { center: ['50%', '50%'], radius: '76%', indicator: data.ability.map(item => ({ name: item.dimension, max: 100 })), axisName: { color: '#a9bbd1', fontSize: 11 }, splitArea: { areaStyle: { color: ['rgba(22,45,75,.15)', 'rgba(22,45,75,.03)'] } }, splitLine: { lineStyle: { color: 'rgba(102,147,202,.2)' } }, axisLine: { lineStyle: { color: 'rgba(102,147,202,.2)' } } },
      series: [{ type: 'radar', data: [{ value: data.ability.map(item => item.score), name: '能力画像', areaStyle: { color: 'rgba(95,106,241,.25)' }, lineStyle: { color: '#6ea8ff', width: 2 }, itemStyle: { color: '#5eead4' } }] }],
    }); else renderChartEmpty('abilityChart', '完成测验后生成能力画像');
    const legend = document.getElementById('subjectLegend');
    if (legend) legend.innerHTML = data.subjectDistribution.slice(0, 5).map((item, index) => `<div><i class="subject-color-${index}"></i><span>${item.subjectName}</span><b>${item.percentage}%</b></div>`).join('');
  }

  function renderChartEmpty(id, text) {
    const node = document.getElementById(id);
    if (!node) return;
    charts.get(id)?.dispose();
    charts.delete(id);
    node.innerHTML = `<div class="dashboard-chart-empty">${text}</div>`;
  }

  function bindInteractions() {
    document.querySelectorAll('#trendRange button').forEach(button => button.addEventListener('click', () => {
      activeRange = Number(button.dataset.range);
      document.querySelectorAll('#trendRange button').forEach(item => item.classList.toggle('active', item === button));
      renderAllCharts(dashboardData);
    }));
  }

  function updateClock() {
    const node = document.getElementById('dashboardDate');
    if (!node) return;
    node.textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
  }

  function observeResize() {
    resizeObserver?.disconnect();
    const root = getRoot();
    if (!root || !window.ResizeObserver) return;
    resizeObserver = new ResizeObserver(() => charts.forEach(chart => chart.resize()));
    resizeObserver.observe(root);
  }

  async function mount() {
    renderShell();
    syncSourceButton();
    updateClock();
    clearInterval(clockTimer);
    clockTimer = setInterval(updateClock, 1000);
    try {
      dashboardData = await StatisticsService.loadDashboard();
      renderDashboard(dashboardData);
      observeResize();
    } catch (error) {
      const main = document.getElementById('dashboardMain');
      if (main) main.innerHTML = StatisticsDashboardComponents.stateView('error', error.message || '数据加载失败');
    }
  }

  function destroy() {
    clearInterval(clockTimer);
    resizeObserver?.disconnect();
    charts.forEach(chart => chart.dispose());
    charts.clear();
  }

  function open() {
    if (location.pathname !== '/statistics/dashboard') history.pushState({ page: 'dashboard' }, '', '/statistics/dashboard');
    UI.switchPage('dashboard');
    mount();
  }

  function back() {
    if (location.pathname !== '/statistics') history.pushState({ page: 'analytics' }, '', '/statistics');
    destroy();
    UI.switchPage('analytics');
  }

  function toggleFullscreen() {
    const element = document.getElementById('page-dashboard');
    if (!document.fullscreenElement) element?.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  function syncSourceButton() {
    const btn = document.getElementById('srcToggleBtn');
    if (!btn) return;
    const span = btn.querySelector('span');
    if (span) span.textContent = window.StudyDataMode.isDemo() ? '接入用户数据' : '查看演示数据';
    btn.classList.toggle('real', !window.StudyDataMode.isDemo());
  }

  function toggleSource() {
    window.StudyDataMode.toggle();
    syncSourceButton();
    mount();
  }

  function boot() {
    if (location.pathname === '/statistics/dashboard') open();
    else if (location.pathname === '/statistics') UI.switchPage('analytics');
    window.addEventListener('popstate', () => location.pathname === '/statistics/dashboard' ? open() : back());
  }
  return { boot, open, back, reload: mount, toggleFullscreen, toggleSource, destroy };
})();

window.openStatisticsDashboard = () => StudyDashboard.open();
window.StudyDashboard = StudyDashboard;
StudyDashboard.boot();
