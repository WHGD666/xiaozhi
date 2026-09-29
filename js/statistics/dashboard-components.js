const StatisticsDashboardComponents = (() => {
  function panel(title, eyebrow, content, extraClass = '') {
    return `<section class="dashboard-panel ${extraClass}"><div class="dashboard-panel-head"><div><span>${eyebrow}</span><h3>${title}</h3></div><i class="fas fa-chart-line"></i></div>${content}</section>`;
  }

  function kpiCard(icon, label, value, suffix, trend) {
    return `<article class="dashboard-kpi"><div class="dashboard-kpi-top"><span>${label}</span><i class="fas ${icon}"></i></div><strong>${value}</strong><small>${suffix}</small><em><i class="fas fa-arrow-trend-up"></i>${trend}</em></article>`;
  }

  function stateView(type, text) {
    return `<div class="dashboard-state ${type}"><i class="fas fa-${type === 'error' ? 'triangle-exclamation' : type === 'empty' ? 'folder-open' : 'circle-notch fa-spin'}"></i><span>${text}</span>${type === 'error' ? '<button onclick="StudyDashboard.reload()">重新加载</button>' : ''}</div>`;
  }
  return { panel, kpiCard, stateView };
})();
