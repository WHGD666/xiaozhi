const StatisticsApi = (() => {
  async function getDashboard() {
    const source = window.StudyDataMode.getSource();
    const response = await fetch(`/api/statistics/dashboard?source=${source}`);
    if (!response.ok) throw new Error('统计数据接口暂时不可用');
    const payload = await response.json();
    if (payload.code !== 200 || !payload.data) throw new Error(payload.message || '统计数据格式异常');
    return payload.data;
  }
  return { getDashboard };
})();
