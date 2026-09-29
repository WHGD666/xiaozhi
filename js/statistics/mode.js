const StudyDataMode = (() => {
  let source = 'demo';

  function getSource() { return source; }
  function setSource(next) { source = next === 'real' ? 'real' : 'demo'; return source; }
  function toggle() { source = source === 'demo' ? 'real' : 'demo'; return source; }
  const isDemo = () => source === 'demo';

  return { getSource, setSource, toggle, isDemo };
})();

window.StudyDataMode = StudyDataMode;