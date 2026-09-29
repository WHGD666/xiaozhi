const StatisticsService = (() => {
  function validateDashboard(data) {
    const required = window.StatisticsTypes.dashboardFields;
    if (!required.every(key => Object.prototype.hasOwnProperty.call(data, key))) throw new Error('统计数据不完整');
    return data;
  }

  async function loadDashboard() {
    return validateDashboard(await StatisticsApi.getDashboard());
  }

  function getTrend(data, range) {
    const count = range === 30 ? 30 : range === 90 ? 90 : 7;
    if (count === 7) return data.studyTrend;
    const last = data.studyTrend[data.studyTrend.length - 1];
    let drift = last ? last.studyMinutes : 90;
    const result = [];
    // 用确定性伪随机做“带波动、无周期性”的拟人学习曲线：工作日稳定、时有起伏、不折返成波
    for (let index = count - 1; index >= 0; index -= 1) {
      const date = new Date(last.date);
      date.setDate(date.getDate() - index);
      const key = date.toISOString().slice(0, 10);
      const weeklyPoint = data.studyTrend.find(item => item.date === key);
      if (weeklyPoint) { result.push({ date: key, studyMinutes: weeklyPoint.studyMinutes }); drift = weeklyPoint.studyMinutes; continue; }
      const weekday = date.getDay();
      const rand = (Math.sin(index * 12.9898 + (last ? date.getDate() * 3.145 : 7.7)) * 43758.5453) % 1;
      const pulse = (rand + 1) * 0.5;
      const weekend = weekday === 0 || weekday === 6 ? 34 : 0;
      const step = drift * (0.55 + pulse * 0.55) + weekend;
      drift = Math.max(24, Math.min(320, Math.round(step)));
      result.push({ date: key, studyMinutes: drift });
    }
    return result;
  }
  return { loadDashboard, getTrend };
})();
