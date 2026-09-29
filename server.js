require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
let DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
let DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
let DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

// 演示密钥独立配置：随仓库 git 分发的公开演示 key，只从这里读取。
// 它不进根目录 .env，也不被 DEEPSEEK_API_KEY 覆盖；接入只写内存、不落盘。
const DEMO_KEY_PATH = path.join(__dirname, 'demo', '111', '.env');
function loadDemoApiKey() {
  try {
    if (!fs.existsSync(DEMO_KEY_PATH)) return '';
    const content = fs.readFileSync(DEMO_KEY_PATH, 'utf8');
    const match = content.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+)\s*$/m);
    const value = match ? match[1].replace(/['"]/g, '').trim() : '';
    if (!value || value === '你的DeepSeek密钥粘贴在这里') return '';
    return value;
  } catch (_) { return ''; }
}
let DEMO_API_KEY = loadDemoApiKey();
const ENV_PATH = path.join(__dirname, '.env');
const conversationStore = new Map();
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_CONTEXT_MESSAGES = 40;
const DATA_DIRECTORY = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIRECTORY, 'learning-records.json');

const SYSTEM_PROMPT = `你是“小知”，一个温暖、耐心、专业的 AI 学习伙伴。请用中文回答，语气自然友好。

你的任务：
1. 帮用户拆解学习问题，而不是只给结论。
2. 遇到题目时按“已知条件、思路、步骤、答案、知识点”讲解。
3. 用户疲惫或沮丧时，先安抚，再给一个可执行的小步骤。
4. 用户需要计划时，给出清晰时间块和休息安排。
5. 普通对话中不要直接生成等待用户作答的整套练习题；这类请求由独立的交互题卡流程处理。讲解知识时可以提供单个示例。
6. 回答简洁，少用表情符号。`;

const INTENT_ROUTER_PROMPT = `你是“小知伴学”的对话意图决策器。你不回答学科问题，也绝不能直接生成练习题；你只根据完整语义、最近对话和当前学习状态，决定下一步动作。

只允许以下三种 action：
1. chat：普通聊天、知识讲解、已有题目解析、学习建议、情绪交流，或者用户只是提到题目但没有要求生成新题。
2. clarify：用户确实想让系统生成新题，但无法可靠确定学科或具体知识点，需要先追问。
3. quiz：用户明确要求生成练习题、测验或“考考我”，或者明确同意助手上一轮提出的出题建议，并且学科和知识点能从当前消息或近期上下文中可靠确定。

判断规则：
- 必须理解完整语义，禁止因为消息中出现“题”“练习”“考试”等词就选择 quiz。
- “这道题怎么做”“做题总是错怎么办”“怎么提高刷题效率”“你是如何出题的”都属于 chat。
- “给我出三道题”“考考我”“再来几道”可以属于 quiz，但“再来几道”必须有近期出题上下文。
- “可以”“好的”“开始吧”只有在助手上一轮明确提出要不要出题时，才能视为 quiz。
- 不得编造学科、知识点、学段、题量或难度。可以继承近期且仍然相关的学习上下文。
- 即使 action 是 clarify，也必须在 quizRequest 中保留用户已经明确提供的字段；例如用户说“三道题”，count 必须为 3，只把真正缺少的字段留空。
- 如果存在尚未提交的测验，除非用户明确要求放弃或重新生成，否则不要生成新测验。
- 无法可靠判断时选择 chat；确定用户想出题但缺必要信息时选择 clarify。
- chat 时不要提供聊天正文，本接口只负责路由，chatReply 固定为 null。
- clarify 时给出一个简洁、自然、只询问必要信息的问题，不要一次盘问过多内容。

只返回合法 JSON，不要 Markdown、代码块或额外文字：
{"action":"chat|clarify|quiz","reasonCode":"简短英文标识","confidence":0.0,"quizRequest":{"subject":"","level":"","topic":"","count":4,"difficulty":""},"clarifyingQuestion":null,"chatReply":null}`;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

function readLearningDatabase() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { sessions: [], quizAttempts: [], wrongQuestions: [], reviews: [] };
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { sessions: Array.isArray(data.sessions) ? data.sessions : [], quizAttempts: Array.isArray(data.quizAttempts) ? data.quizAttempts : [], wrongQuestions: Array.isArray(data.wrongQuestions) ? data.wrongQuestions : [], reviews: Array.isArray(data.reviews) ? data.reviews : [] };
  } catch (error) {
    console.error('读取本地学习数据失败：', error.message);
    return { sessions: [], quizAttempts: [], wrongQuestions: [], reviews: [] };
  }
}

function saveLearningDatabase(data) {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function createRecordId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasValidApiKey() {
  return Boolean(DEEPSEEK_API_KEY && DEEPSEEK_API_KEY !== '你的DeepSeek密钥粘贴在这里');
}

function writeEnvFile(updates) {
  const defaults = {
    DEEPSEEK_API_KEY: '',
    DEEPSEEK_MODEL: DEEPSEEK_MODEL,
    DEEPSEEK_API_URL: DEEPSEEK_API_URL,
    PORT: PORT,
  };
  const next = { ...defaults, ...updates };
  const content = [
    '# DeepSeek API 配置',
    `DEEPSEEK_API_KEY=${next.DEEPSEEK_API_KEY || ''}`,
    `DEEPSEEK_MODEL=${next.DEEPSEEK_MODEL}`,
    `DEEPSEEK_API_URL=${next.DEEPSEEK_API_URL}`,
    '',
    '# 本地服务端口',
    `PORT=${next.PORT}`,
    '',
  ].join('\n');
  fs.writeFileSync(ENV_PATH, content, { encoding: 'utf8', flag: 'w' });
}

function getContext(sessionId) {
  if (!conversationStore.has(sessionId)) conversationStore.set(sessionId, []);
  return conversationStore.get(sessionId);
}

function normalizeMessages(messages) {
  return messages
    .filter(item => item.content && String(item.content).trim())
    .map(item => ({ role: item.role, content: String(item.content).trim().slice(0, 8000) }));
}

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function publicError(error) {
  if (error.name === 'AbortError') return '大模型响应超时，请稍后重试。';
  if (error.type === 'system' || error.type === 'network_error' || error instanceof TypeError) return '无法连接到大模型服务，请检查网络后重试。';
  if (/未配置/.test(error.message)) return '服务端尚未配置大模型密钥。';
  if (/API 错误 401|API 错误 403/.test(error.message)) return '大模型密钥无效或没有访问权限，请在右上角“接入大模型”重新配置。';
  if (/API 错误 429/.test(error.message)) return '大模型请求过于频繁，请稍后重试。';
  if (/API 错误 5\d\d/.test(error.message)) return '大模型服务暂时不可用，请稍后重试。';
  if (/JSON/.test(error.message)) return '大模型返回格式异常，请重新生成。';
  return '大模型连接失败，请检查网络或稍后重试。';
}

function parseJsonReply(reply) {
  const cleaned = reply
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

function normalizeIntentHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-12).map(item => ({
    role: item?.role === 'agent' || item?.role === 'assistant' ? 'assistant' : 'user',
    content: normalizeText(item?.content ?? item?.text, 1200),
  })).filter(item => item.content);
}

function normalizeIntentDecision(payload) {
  const allowedActions = new Set(['chat', 'clarify', 'quiz']);
  let action = allowedActions.has(payload?.action) ? payload.action : 'chat';
  const rawQuiz = payload?.quizRequest || {};
  const quizRequest = {
    subject: normalizeText(rawQuiz.subject, 120),
    level: normalizeText(rawQuiz.level, 80),
    topic: normalizeText(rawQuiz.topic, 200),
    count: Math.min(8, Math.max(1, Number.parseInt(rawQuiz.count, 10) || 4)),
    difficulty: normalizeText(rawQuiz.difficulty, 80),
  };
  let clarifyingQuestion = normalizeText(payload?.clarifyingQuestion, 240);

  // 模型负责语义判断；代码只做结构和安全边界校验，缺少关键参数时绝不直接出题。
  if (action === 'quiz' && (!quizRequest.subject || !quizRequest.topic)) action = 'clarify';
  if (action === 'clarify' && !clarifyingQuestion) {
    clarifyingQuestion = quizRequest.subject
      ? `可以。你想练 ${quizRequest.subject} 的哪个具体知识点？`
      : '可以。你想练哪个学科和具体知识点？';
  }

  return {
    action,
    reasonCode: normalizeText(payload?.reasonCode, 80) || 'model_decision',
    confidence: Math.min(1, Math.max(0, Number(payload?.confidence) || 0)),
    quizRequest,
    clarifyingQuestion: action === 'clarify' ? clarifyingQuestion : null,
    chatReply: null,
  };
}

function validateQuizPayload(payload, expectedCount) {
  const questions = payload?.questions;
  if (!Array.isArray(questions) || questions.length < expectedCount) throw new Error('题目数量不足');
  const genericQuestion = /学习中.*第.?步|哪种方式更有效|学习习惯|错因和触发条件|主动回忆|只背答案|只看难题|跳过例题/;
  return questions.slice(0, expectedCount).map((item, index) => {
    const question = normalizeText(item?.question, 700);
    const options = Array.isArray(item?.options) ? item.options.map(option => normalizeText(option, 500)) : [];
    const answer = normalizeText(item?.answer, 1).toUpperCase();
    const weakPoint = normalizeText(item?.weakPoint, 80);
    const explanation = normalizeText(item?.explanation, 900);
    if (!question || genericQuestion.test(question) || options.length !== 4 || !/^[ABCD]$/.test(answer) || !weakPoint || !explanation) {
      throw new Error(`第 ${index + 1} 题不符合学科练习要求`);
    }
    const expectedLabels = ['A', 'B', 'C', 'D'];
    if (!options.every((option, optionIndex) => option.startsWith(`${expectedLabels[optionIndex]}.`) || option.startsWith(`${expectedLabels[optionIndex]}、`))) {
      throw new Error(`第 ${index + 1} 题选项格式不正确`);
    }
    if (!options.some(option => option.startsWith(`${answer}.`) || option.startsWith(`${answer}、`))) throw new Error(`第 ${index + 1} 题答案不在选项中`);
    return { question, options, answer, weakPoint, explanation };
  });
}

async function callDeepSeek(messages, options = {}) {
  if (!hasValidApiKey()) throw new Error('未配置 DEEPSEEK_API_KEY');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(DEEPSEEK_API_URL, {

      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model || DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: options.systemPrompt || SYSTEM_PROMPT },
          ...normalizeMessages(messages),
        ],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 1600,
        stream: false,
        thinking: { type: options.thinking || 'disabled' },
      }),
    });

    if (!response.ok) throw new Error(`DeepSeek API 错误 ${response.status}`);

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';
    if (!reply.trim()) throw new Error('大模型没有返回内容');
    return reply;
  } finally {
    clearTimeout(timeout);
  }
}

// 验证 DeepSeek API Key 是否有效，只在用户接入/更换 key 时调用。
// 返回: 'valid' | 'invalid' | 'network'
async function validateDeepSeekKey(apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 1,
        stream: false,
        thinking: { type: 'disabled' },
      }),
    });
    if (response.ok) return 'valid';
    if (response.status === 401 || response.status === 403) return 'invalid';
    return 'network';
  } catch (error) {
    if (error.name === 'AbortError') return 'network';
    return 'network';
  } finally {
    clearTimeout(timeout);
  }
}

app.post('/api/route-intent', async (req, res) => {
  try {
    const message = normalizeText(req.body.message, 4000);
    if (!message) return res.status(400).json({ success: false, error: '消息不能为空' });

    const history = normalizeIntentHistory(req.body.history);
    const rawContext = req.body.learningContext || {};
    const learningContext = {
      subject: normalizeText(rawContext.subject, 120),
      level: normalizeText(rawContext.level, 80),
      topic: normalizeText(rawContext.topic, 200),
      difficulty: normalizeText(rawContext.difficulty, 80),
      quizActive: Boolean(rawContext.quizActive),
      lastQuizSpec: rawContext.lastQuizSpec && typeof rawContext.lastQuizSpec === 'object' ? {
        subject: normalizeText(rawContext.lastQuizSpec.subject, 120),
        level: normalizeText(rawContext.lastQuizSpec.level, 80),
        topic: normalizeText(rawContext.lastQuizSpec.topic, 200),
        difficulty: normalizeText(rawContext.lastQuizSpec.difficulty, 80),
        count: Math.min(8, Math.max(1, Number.parseInt(rawContext.lastQuizSpec.count, 10) || 4)),
      } : null,
    };
    const historyText = history.length
      ? history.map(item => `${item.role === 'assistant' ? '助手' : '用户'}：${item.content}`).join('\n')
      : '无';
    const routingInput = `当前学习状态：${JSON.stringify(learningContext)}\n\n最近对话：\n${historyText}\n\n当前用户消息：${message}`;
    const options = {
      temperature: 0.1,
      maxTokens: 500,
      systemPrompt: INTENT_ROUTER_PROMPT,
    };

    const reply = await callDeepSeek([{ role: 'user', content: routingInput }], options);
    let decision;
    try {
      decision = normalizeIntentDecision(parseJsonReply(reply));
    } catch (parseError) {
      const retry = await callDeepSeek([{
        role: 'user',
        content: `${routingInput}\n\n上一轮决策结果无法解析：${normalizeText(parseError.message, 160)}。请重新判断并只输出规定的 JSON。`,
      }], options);
      decision = normalizeIntentDecision(parseJsonReply(retry));
    }

    res.json({ success: true, data: decision, provider: 'deepseek', model: DEEPSEEK_MODEL });
  } catch (error) {
    res.status(502).json({ success: false, error: publicError(error), provider: 'deepseek' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const message = normalizeText(req.body.message, 4000);
    const sessionId = normalizeText(req.body.sessionId, 80) || 'default';
    if (!message) return res.status(400).json({ success: false, error: '消息不能为空' });

    const context = getContext(sessionId);
    context.push({ role: 'user', content: message });
    const recentContext = context.slice(-20);
    const reply = await callDeepSeek(recentContext);
    context.push({ role: 'assistant', content: reply });
    if (context.length > MAX_CONTEXT_MESSAGES) context.splice(0, context.length - MAX_CONTEXT_MESSAGES);

    res.json({ success: true, reply, sessionId, provider: 'deepseek', model: DEEPSEEK_MODEL });
  } catch (error) {
    res.status(502).json({ success: false, error: publicError(error), provider: 'deepseek' });
  }
});

app.post('/api/solve', async (req, res) => {
  try {
    const description = normalizeText(req.body.description, 8000);
    const sessionId = normalizeText(req.body.sessionId, 80) || 'default';
    if (!description) return res.status(400).json({ success: false, error: '题目描述不能为空' });
    const reply = await callDeepSeek([
      { role: 'user', content: `请帮助用户解析这道题，按“题目分析、解题思路、详细步骤、最终答案、知识点总结”回答：${description}` },
    ]);
    res.json({ success: true, reply, sessionId, provider: 'deepseek', model: DEEPSEEK_MODEL });
  } catch (error) {
    res.status(502).json({ success: false, error: publicError(error), provider: 'deepseek' });
  }
});

app.post('/api/generate-quiz', async (req, res) => {
  try {
    const subject = normalizeText(req.body.subject, 120);
    const topic = normalizeText(req.body.topic, 200);
    const level = normalizeText(req.body.level, 80);
    const difficulty = normalizeText(req.body.difficulty, 80);
    const mode = normalizeText(req.body.mode, 80);
    const count = Math.min(8, Math.max(1, Number.parseInt(req.body.count, 10) || 4));
    if (!subject || !topic) return res.status(400).json({ success: false, error: 'subject 和 topic 不能为空' });

    const prompt = `请围绕“${subject}${level ? `（${level}）` : ''} - ${topic}”生成 ${count} 道可直接用于学习诊断的高质量选择题。
要求：
1. 难度必须匹配学段：${level || '按常规入门到中等难度'}。
2. 每题必须考察“${topic}”中的具体知识、代码/公式/现象/解题步骤或典型错误，用户答对后应能反映对该知识点的掌握。
3. 至少两题必须是具体应用题：给出条件、代码片段、计算过程或实际情境后要求判断结果。不得只问定义口号。
4. 严禁出现学习方法、复习建议、做题策略、学习习惯、错题记录等内容；严禁使用“第一步更适合关注什么”“哪种方式更有效”这类题干。
5. 四个选项都要贴近该知识点，且只有一个明确正确答案；不能用明显荒谬的干扰项。
6. 解析要指出正确依据，并说明至少一个常见误区；weakPoint 必须是具体知识点名称。
7. 当前学习模式：${mode || '未指定'}。
8. 用户要求的题目难度：${difficulty || '按当前学段采用基础到中等难度'}。
只返回 JSON，不要 Markdown。
格式：{"questions":[{"question":"题干","options":["A.选项","B.选项","C.选项","D.选项"],"answer":"A","weakPoint":"薄弱点名称","explanation":"解析"}]}`;

    const requestOptions = {
      temperature: 0.4,
      maxTokens: 2600,
      systemPrompt: '你是严格的学科测验命题老师。只出能检验具体知识点掌握程度的题，不出学习方法或常识题。你必须只输出可解析 JSON。',
    };
    let questions;
    try {
      const reply = await callDeepSeek([{ role: 'user', content: prompt }], requestOptions);
      questions = validateQuizPayload(parseJsonReply(reply), count);
    } catch (firstError) {
      const retryReply = await callDeepSeek([{ role: 'user', content: `${prompt}\n上一稿未通过质量校验：${firstError.message}。请完全重写，尤其确保每题都在考查具体学科知识。` }], requestOptions);
      questions = validateQuizPayload(parseJsonReply(retryReply), count);
    }

    res.json({ success: true, data: { questions }, provider: 'deepseek', model: DEEPSEEK_MODEL });
  } catch (error) {
    res.status(502).json({ success: false, error: publicError(error), provider: 'deepseek' });
  }
});

app.post('/api/learning-options', async (req, res) => {
  try {
    const subject = normalizeText(req.body.subject, 120);
    const level = normalizeText(req.body.level, 80);
    if (!subject) return res.status(400).json({ success: false, error: 'subject 不能为空' });

    const reply = await callDeepSeek([{
      role: 'user',
      content: `为学习主题“${subject}${level ? `（${level}）` : ''}”生成下一步学习选择。只返回 JSON，不要 Markdown。\n格式：{"levels":["学段1","学段2"],"topics":["模块1","模块2","模块3","模块4","模块5","模块6"],"modes":[{"key":"review","title":"直接复习","desc":"一句话说明"},{"key":"quiz-review","title":"先测再复习","desc":"一句话说明"},{"key":"learn-practice","title":"先学后练","desc":"一句话说明"}]}\n要求：levels 只在确实存在学段差异时给 3-5 项；topics 必须是当前主题最合适的 4-6 个具体模块；modes 必须保留这三个固定 key，但标题和说明要贴合该主题。`,
    }], {
      temperature: 0.35,
      maxTokens: 900,
      systemPrompt: '你是学习路径规划助手。只能输出可解析 JSON，不能输出多余文字。',
    });
    const raw = parseJsonReply(reply);
    const cleanList = (items, max) => Array.isArray(items)
      ? items.map(item => normalizeText(item, 60)).filter(Boolean).slice(0, max)
      : [];
    const allowedModeKeys = new Set(['review', 'quiz-review', 'learn-practice']);
    const modes = Array.isArray(raw.modes) ? raw.modes
      .filter(item => item && allowedModeKeys.has(item.key))
      .map(item => ({ key: item.key, title: normalizeText(item.title, 30), desc: normalizeText(item.desc, 80) }))
      .filter(item => item.title && item.desc)
      : [];
    res.json({ success: true, data: { levels: cleanList(raw.levels, 5), topics: cleanList(raw.topics, 6), modes }, provider: 'deepseek', model: DEEPSEEK_MODEL });
  } catch (error) {
    res.status(502).json({ success: false, error: publicError(error), provider: 'deepseek' });
  }
});

app.post('/api/learning/quiz-attempt', (req, res) => {
  try {
    const subject = normalizeText(req.body.subject, 120);
    const topic = normalizeText(req.body.topic, 200);
    const level = normalizeText(req.body.level, 80);
    const questions = Array.isArray(req.body.questions) ? req.body.questions.slice(0, 8) : [];
    if (!subject || !topic || !questions.length) return res.status(400).json({ success: false, error: '答题记录不完整' });
    const wrongQuestions = questions.filter(item => item && item.isWrong).map(item => ({
      id: createRecordId('wrong'), subject, topic, level,
      question: normalizeText(item.question, 700), answer: normalizeText(item.answer, 1), selected: normalizeText(item.selected, 1),
      weakPoint: normalizeText(item.weakPoint, 100), explanation: normalizeText(item.explanation, 1000), createdAt: new Date().toISOString(),
    })).filter(item => item.question && item.answer);
    const database = readLearningDatabase();
    database.quizAttempts.push({ id: createRecordId('attempt'), subject, topic, level, questionCount: questions.length, wrongCount: wrongQuestions.length, completedAt: new Date().toISOString() });
    database.wrongQuestions.push(...wrongQuestions);
    database.quizAttempts = database.quizAttempts.slice(-500);
    database.wrongQuestions = database.wrongQuestions.slice(-1000);
    saveLearningDatabase(database);
    res.json({ success: true, data: { wrongQuestions, attemptCount: database.quizAttempts.length } });
  } catch (error) {
    res.status(500).json({ success: false, error: '本地学习记录保存失败' });
  }
});

app.post('/api/learning/session', (req, res) => {
  try {
    const subject = normalizeText(req.body.subject, 120) || '未分类';
    const topic = normalizeText(req.body.topic, 200);
    const durationMinutes = Math.min(720, Math.max(0, Number.parseInt(req.body.durationMinutes, 10) || 0));
    if (!durationMinutes) return res.json({ success: true, data: null });
    const database = readLearningDatabase();
    database.sessions.push({ id: createRecordId('session'), subject, topic, durationMinutes, endedAt: new Date().toISOString() });
    database.sessions = database.sessions.slice(-2000);
    saveLearningDatabase(database);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: '学习时长保存失败' });
  }
});

function parseReviewAnalysis(reply) {
  const raw = parseJsonReply(reply);
  const analysis = raw?.analysis || {};
  const plans = Array.isArray(raw?.plans) ? raw.plans.slice(0, 3) : [];
  if (!normalizeText(analysis.summary, 600) || !plans.length) throw new Error('复盘结果格式不完整');
  const cleanedPlans = plans.map((plan, index) => {
    const steps = Array.isArray(plan.steps) ? plan.steps.map(step => normalizeText(step, 240)).filter(Boolean).slice(0, 5) : [];
    return { id: `plan-${index + 1}`, title: normalizeText(plan.title, 80), fit: normalizeText(plan.fit, 120), why: normalizeText(plan.why, 300), steps };
  }).filter(plan => plan.title && plan.fit && plan.why && plan.steps.length >= 2);
  if (cleanedPlans.length < 2) throw new Error('复习方案数量不足');
  return { analysis: { summary: normalizeText(analysis.summary, 600), keyWeaknesses: Array.isArray(analysis.keyWeaknesses) ? analysis.keyWeaknesses.map(item => normalizeText(item, 100)).filter(Boolean).slice(0, 5) : [] }, plans: cleanedPlans };
}

app.post('/api/review-analysis', async (req, res) => {
  try {
    const subject = normalizeText(req.body.subject, 120);
    const topic = normalizeText(req.body.topic, 200);
    const level = normalizeText(req.body.level, 80);
    const wrongQuestions = Array.isArray(req.body.wrongQuestions) ? req.body.wrongQuestions.slice(0, 8) : [];
    if (!subject || !topic || !wrongQuestions.length) return res.status(400).json({ success: false, error: '需要至少一道错题才能生成 AI 复盘' });
    const evidence = wrongQuestions.map((item, index) => `${index + 1}. 题目：${normalizeText(item.question, 700)}\n正确答案：${normalizeText(item.answer, 1)}；用户答案：${normalizeText(item.selected, 1)}\n已知薄弱点：${normalizeText(item.weakPoint, 100)}\n解析：${normalizeText(item.explanation, 900)}`).join('\n\n');
    const prompt = `你是学习诊断老师。请根据真实错题做复盘，主题是“${subject}${level ? `（${level}）` : ''} - ${topic}”。\n\n错题证据：\n${evidence}\n\n先分析错因，再给 2-3 种不同的复习方案。方案要有适用情形、原因、2-5 个具体学习动作。不要生成具体时钟时间；时间表将在用户选方案后单独生成。只返回 JSON：{"analysis":{"summary":"错因分析","keyWeaknesses":["具体薄弱点"]},"plans":[{"title":"方案名","fit":"适合什么情况","why":"为什么适合","steps":["具体动作"]}]}`;
    const reply = await callDeepSeek([{ role: 'user', content: prompt }], { temperature: 0.35, maxTokens: 1800, systemPrompt: '你只根据给出的错题证据诊断，不要编造用户未做过的题。必须输出可解析 JSON。' });
    const review = parseReviewAnalysis(reply);
    const database = readLearningDatabase();
    const reviewId = createRecordId('review');
    database.reviews.push({ id: reviewId, subject, topic, level, wrongQuestionIds: wrongQuestions.map(item => item.id).filter(Boolean), ...review, createdAt: new Date().toISOString() });
    database.reviews = database.reviews.slice(-300);
    saveLearningDatabase(database);
    res.json({ success: true, data: { reviewId, ...review }, provider: 'deepseek', model: DEEPSEEK_MODEL });
  } catch (error) {
    res.status(502).json({ success: false, error: publicError(error), provider: 'deepseek' });
  }
});

app.post('/api/review-schedule', async (req, res) => {
  try {
    const reviewId = normalizeText(req.body.reviewId, 80);
    const planId = normalizeText(req.body.planId, 40);
    const availableMinutes = Math.min(240, Math.max(15, Number.parseInt(req.body.availableMinutes, 10) || 45));
    const database = readLearningDatabase();
    const review = database.reviews.find(item => item.id === reviewId);
    const plan = review?.plans?.find(item => item.id === planId);
    if (!review || !plan) return res.status(404).json({ success: false, error: '未找到对应的复盘方案' });
    const reply = await callDeepSeek([{ role: 'user', content: `为“${review.subject} - ${review.topic}”的复习方案“${plan.title}”安排总计 ${availableMinutes} 分钟的可执行时间表。方案步骤：${plan.steps.join('；')}。只返回 JSON：{"total":${availableMinutes},"blocks":[{"duration":15,"title":"阶段名","detail":"具体要做什么","tasks":["动作1","动作2"]}]}。所有 duration 之和必须等于 ${availableMinutes}。` }], { temperature: 0.25, maxTokens: 1200, systemPrompt: '你是学习计划教练。只能输出可解析 JSON，安排必须落实到具体学习动作。' });
    const schedule = parseJsonReply(reply);
    const blocks = Array.isArray(schedule.blocks) ? schedule.blocks.map(item => ({ duration: Math.max(1, Number.parseInt(item.duration, 10) || 0), title: normalizeText(item.title, 80), detail: normalizeText(item.detail, 240), tasks: Array.isArray(item.tasks) ? item.tasks.map(task => normalizeText(task, 180)).filter(Boolean).slice(0, 4) : [] })).filter(item => item.title && item.detail) : [];
    if (!blocks.length || blocks.reduce((sum, block) => sum + block.duration, 0) !== availableMinutes) throw new Error('时间表格式不正确');
    review.schedule = { total: availableMinutes, blocks, selectedPlanId: planId, createdAt: new Date().toISOString() };
    saveLearningDatabase(database);
    res.json({ success: true, data: review.schedule, provider: 'deepseek', model: DEEPSEEK_MODEL });
  } catch (error) {
    res.status(502).json({ success: false, error: publicError(error), provider: 'deepseek' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ success: true, hasApiKey: hasValidApiKey(), model: DEEPSEEK_MODEL, apiUrl: DEEPSEEK_API_URL.replace(/\/chat\/completions$/, '') });
});

app.post('/api/config', async (req, res) => {
  const apiKey = String((req.body && req.body.apiKey) || '').trim();
  if (!apiKey) {
    DEEPSEEK_API_KEY = '';
    writeEnvFile({ DEEPSEEK_API_KEY: '' });
    return res.json({ success: true, hasApiKey: false, message: '已清除大模型密钥，当前为本地演示模式' });
  }
  if (!/^sk-/.test(apiKey)) {
    return res.status(400).json({ success: false, valid: 'invalid', error: '密钥格式不正确，应以 sk- 开头' });
  }
  const validity = await validateDeepSeekKey(apiKey);
  if (validity === 'invalid') {
    return res.status(400).json({ success: false, valid: 'invalid', error: '密钥无效，请确认后重新输入' });
  }
  DEEPSEEK_API_KEY = apiKey;
  writeEnvFile({ DEEPSEEK_API_KEY: apiKey });
  if (validity === 'network') {
    return res.json({ success: true, valid: 'network', hasApiKey: true, message: '大模型密钥已保存，但当前网络可能不通，请稍后重试对话' });
  }
  res.json({ success: true, valid: 'valid', hasApiKey: hasValidApiKey(), message: '大模型已接入，立即生效' });
});

// 一键接入测试密钥：演示 key 只从独立配置（demo/111/.env）读取，
// 随 git 分发、仅在内存激活；既不经过前台，也不落盘覆盖根目录 .env，两者互不干扰。
app.post('/api/config/test-key', async (req, res) => {
  if (!DEMO_API_KEY) {
    return res.status(400).json({ success: false, error: '未检测到演示密钥，请在 demo/111/.env 中配置 DEEPSEEK_API_KEY 并确认其值可用' });
  }
  const validity = await validateDeepSeekKey(DEMO_API_KEY);
  if (validity === 'invalid') {
    return res.status(400).json({ success: false, valid: 'invalid', error: '演示密钥无效，请检查 demo/111/.env 中的 DEEPSEEK_API_KEY' });
  }
  DEEPSEEK_API_KEY = DEMO_API_KEY; // 仅写入内存，不覆盖磁盘上的根目录 .env 配置
  if (validity === 'network') {
    return res.json({ success: true, valid: 'network', hasApiKey: true, message: '已接入演示密钥，但当前网络可能不通，请稍后重试对话' });
  }
  res.json({ success: true, valid: 'valid', hasApiKey: hasValidApiKey(), message: '已接入演示密钥，立即生效' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', provider: 'deepseek', hasApiKey: hasValidApiKey(), model: DEEPSEEK_MODEL, time: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({ provider: 'deepseek', hasApiKey: hasValidApiKey(), model: DEEPSEEK_MODEL, apiUrl: DEEPSEEK_API_URL.replace(/\/chat\/completions$/, '') });
});

// Dashboard contract: keep the UI independent from today's mock data source.
function buildStatisticsDashboardMock() {
  const subjectDistribution = [
    { subjectId: 'math', subjectName: '高等数学', studyMinutes: 290, percentage: 26 },
    { subjectId: 'python', subjectName: 'Python', studyMinutes: 245, percentage: 22 },
    { subjectId: 'algorithm', subjectName: '算法', studyMinutes: 200, percentage: 18 },
    { subjectId: 'english', subjectName: '英语', studyMinutes: 165, percentage: 15 },
    { subjectId: 'ai', subjectName: '人工智能', studyMinutes: 155, percentage: 14 },
    { subjectId: 'other', subjectName: '其他', studyMinutes: 61, percentage: 5 },
  ];
  const weeklyMinutes = [72, 126, 96, 168, 186, 144, 324];
  const now = new Date();
  const toDateKey = date => date.toISOString().slice(0, 10);
  const studyTrend = weeklyMinutes.map((studyMinutes, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    return { date: toDateKey(date), studyMinutes };
  });
  // 90 天热力：拟人化学习节奏——绝大多数日子低调低活跃（深色），穿插少数高投入高峰日（亮蓝/冰蓝），疏密对比明显、随机但连续
  const heatmap = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (89 - index));
    const seed = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
    const rand = (seed - Math.floor(seed));
    let minutes;
    if (rand < 0.16) minutes = Math.round(rand / 0.16 * 28);              // 完全没学/极低 0-28（16%）
    else if (rand < 0.52) minutes = 30 + Math.round((rand - 0.16) / 0.36 * 45); // 低活跃 30-75（36%）
    else if (rand < 0.80) minutes = 82 + Math.round((rand - 0.52) / 0.28 * 60); // 中等 82-142（28%）
    else if (rand < 0.93) minutes = 150 + Math.round((rand - 0.80) / 0.13 * 60); // 较活跃 150-210（13%）
    else minutes = 218 + Math.round((rand - 0.93) / 0.07 * 70);            // 高峰 218-260（7%）
    const studyMinutes = Math.max(0, Math.min(260, Math.round(minutes)));
    return { date: toDateKey(date), studyMinutes, completedTasks: studyMinutes ? Math.max(1, Math.round(studyMinutes / 26)) : 0 };
  });

  return {
    overview: { todayStudyMinutes: 156, weeklyStudyMinutes: 1116, completedTasks: 8, totalTasks: 10, streakDays: 12, focusScore: 86, monthlyStudyDays: 23 },
    studyTrend,
    subjectDistribution,
    heatmap,
    ability: [
      { dimension: '数学', score: 78 }, { dimension: '编程', score: 88 }, { dimension: '算法', score: 71 },
      { dimension: '英语', score: 65 }, { dimension: 'AI', score: 82 }, { dimension: '专业课', score: 76 },
    ],
    timeDistribution: [
      { hour: 0, studyMinutes: 0 }, { hour: 3, studyMinutes: 0 }, { hour: 6, studyMinutes: 18 },
      { hour: 9, studyMinutes: 72 }, { hour: 12, studyMinutes: 34 }, { hour: 15, studyMinutes: 58 },
      { hour: 18, studyMinutes: 104 }, { hour: 21, studyMinutes: 138 }, { hour: 24, studyMinutes: 12 },
    ],
    currentStatus: { status: '学习中', task: 'Python 动态规划', elapsedSeconds: 2538, goalSeconds: 7200, progress: 35 },
    insights: [
      { type: 'growth', title: '学习节奏正在变稳', description: '本周学习时长较上周提升 12.6%，连续学习已保持 12 天。' },
      { type: 'time', title: '晚间是你的高效窗口', description: '19:00 - 22:00 的专注时长最高，建议把算法训练安排在这个时段。' },
      { type: 'suggestion', title: '算法需要补一次专项训练', description: '算法学习占比近期有所下降，本周增加 2 次 45 分钟训练会更均衡。' },
    ],
  };
}

function buildDashboardFromRecords() {
  const database = readLearningDatabase();
  const now = new Date();
  const dayKey = date => new Date(date).toISOString().slice(0, 10);
  const today = dayKey(now);
  const sessions = database.sessions;
  const attempts = database.quizAttempts;
  const dailyMinutes = new Map();
  const subjectMinutes = new Map();
  sessions.forEach(session => {
    const date = dayKey(session.endedAt);
    dailyMinutes.set(date, (dailyMinutes.get(date) || 0) + session.durationMinutes);
    subjectMinutes.set(session.subject, (subjectMinutes.get(session.subject) || 0) + session.durationMinutes);
  });
  const recentDates = Array.from({ length: 90 }, (_, index) => { const date = new Date(now); date.setDate(now.getDate() - (89 - index)); return dayKey(date); });
  const heatmap = recentDates.map(date => ({ date, studyMinutes: dailyMinutes.get(date) || 0, completedTasks: attempts.filter(item => dayKey(item.completedAt) === date).length }));
  const studyTrend = heatmap.slice(-7).map(item => ({ date: item.date, studyMinutes: item.studyMinutes }));
  const weeklyStudyMinutes = studyTrend.reduce((sum, item) => sum + item.studyMinutes, 0);
  const totalMinutes = [...subjectMinutes.values()].reduce((sum, value) => sum + value, 0);
  const subjectDistribution = [...subjectMinutes.entries()].map(([subjectName, studyMinutes], index) => ({ subjectId: `subject-${index}`, subjectName, studyMinutes, percentage: totalMinutes ? Math.round(studyMinutes / totalMinutes * 100) : 0 }));
  const todayAttempts = attempts.filter(item => dayKey(item.completedAt) === today);
  const completedTasks = todayAttempts.length;
  const accuracy = attempts.length ? Math.round((attempts.reduce((sum, item) => sum + item.questionCount - item.wrongCount, 0) / attempts.reduce((sum, item) => sum + item.questionCount, 0)) * 100) : 0;
  const ability = subjectDistribution.slice(0, 6).map(item => ({ dimension: item.subjectName, score: accuracy }));
  const timeDistribution = [0, 3, 6, 9, 12, 15, 18, 21, 24].map(hour => ({ hour, studyMinutes: sessions.filter(item => new Date(item.endedAt).getHours() >= hour && new Date(item.endedAt).getHours() < hour + 3).reduce((sum, item) => sum + item.durationMinutes, 0) }));
  const insights = totalMinutes ? [{ type: 'record', title: '数据来自本地学习记录', description: `已累计 ${totalMinutes} 分钟学习和 ${attempts.length} 次测验；后续洞察会随真实记录更新。` }] : [{ type: 'empty', title: '还没有可分析的学习记录', description: '完成一次学习和测验后，这里会根据本地数据生成学习画像。' }];
  const monthlyStudyDays = heatmap.filter(item => item.studyMinutes > 0 && item.date.slice(0, 7) === today.slice(0, 7)).length;
  return { overview: { todayStudyMinutes: dailyMinutes.get(today) || 0, weeklyStudyMinutes, completedTasks, totalTasks: completedTasks, streakDays: 0, focusScore: accuracy, monthlyStudyDays }, studyTrend, subjectDistribution, heatmap, ability, timeDistribution, currentStatus: { status: '未在学习', task: '暂无进行中的任务', elapsedSeconds: 0, goalSeconds: 0, progress: 0 }, insights };
}

app.get('/api/statistics/dashboard', (req, res) => {
  const data = req.query.source === 'real' ? buildDashboardFromRecords() : buildStatisticsDashboardMock();
  res.json({ code: 200, message: 'success', data });
});

app.get(['/statistics', '/statistics/dashboard'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`小知服务已启动: http://localhost:${PORT}`);
  console.log(`模型服务: DeepSeek`);
  console.log(`模型: ${DEEPSEEK_MODEL}`);
  console.log(`API Key: ${hasValidApiKey() ? '已配置' : '未配置，可在前端页面接入大模型'}`);
});
