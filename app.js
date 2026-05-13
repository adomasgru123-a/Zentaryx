'use strict';

// ── State ──────────────────────────────────────
const state = {
  apiKey: '',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are Zentaryx, a helpful and knowledgeable AI assistant. Be concise, friendly, and accurate.',
  chats: {},
  activeChatId: null,
  agent: 'assistant',
  isLoading: false,
};

// ── Agent personas ─────────────────────────────
const agentPersonas = {
  assistant: { name: 'Zentaryx', systemSuffix: '' },
  coder: {
    name: 'Coder',
    systemSuffix: ' You specialize in programming. Provide clean code with explanations.',
  },
  analyst: {
    name: 'Analyst',
    systemSuffix: ' You specialize in data analysis and structured reasoning. Use bullet points and logical breakdowns.',
  },
};

// ── Persistence ────────────────────────────────
function save() {
  try {
    localStorage.setItem('zentaryx_chats', JSON.stringify(state.chats));
    localStorage.setItem('zentaryx_settings', JSON.stringify({
      apiKey: state.apiKey,
      model: state.model,
      systemPrompt: state.systemPrompt,
    }));
  } catch (_) {}
}

function load() {
  try {
    const settings = JSON.parse(localStorage.getItem('zentaryx_settings') || '{}');
    state.apiKey = settings.apiKey || '';
    state.model = settings.model || 'claude-sonnet-4-6';
    state.systemPrompt = settings.systemPrompt || state.systemPrompt;
    state.chats = JSON.parse(localStorage.getItem('zentaryx_chats') || '{}');
  } catch (_) {}
}

// ── DOM Refs ───────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  sidebar: $('sidebar'),
  sidebarToggle: $('sidebarToggle'),
  mobileSidebarBtn: $('mobileSidebarBtn'),
  newChatBtn: $('newChatBtn'),
  historyList: $('historyList'),
  chatArea: $('chatArea'),
  welcomeScreen: $('welcomeScreen'),
  messages: $('messages'),
  chatInput: $('chatInput'),
  sendBtn: $('sendBtn'),
  clearChatBtn: $('clearChatBtn'),
  pillModelSelect: $('pillModelSelect'),
  apiDot: $('apiDot'),
  apiLabel: $('apiLabel'),
  settingsModal: $('settingsModal'),
  openSettings: $('openSettings'),
  topSettingsBtn: $('topSettingsBtn'),
  closeSettings: $('closeSettings'),
  cancelSettings: $('cancelSettings'),
  saveSettings: $('saveSettings'),
  apiKeyInput: $('apiKeyInput'),
  modelSelect: $('modelSelect'),
  systemPrompt: $('systemPrompt'),
  toggleKey: $('toggleKey'),
};

// ── Toast ──────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Markdown renderer ──────────────────────────
function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="language-${lang}">${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<p>${html}</p>`
    .replace(/<p><\/p>/g, '')
    .replace(/<p>(<pre>|<h[1-3]>|<ul>|<blockquote>)/g, '$1')
    .replace(/(<\/pre>|<\/h[1-3]>|<\/ul>|<\/blockquote>)<\/p>/g, '$1');
}

// ── Chat Management ────────────────────────────
function createChat() {
  const id = `chat_${Date.now()}`;
  state.chats[id] = { id, title: 'New Chat', agent: state.agent, messages: [], createdAt: Date.now() };
  return id;
}

function switchChat(id) {
  state.activeChatId = id;
  renderMessages();
  renderHistory();
  updateWelcome();
}

function deleteChat(id) {
  delete state.chats[id];
  if (state.activeChatId === id) {
    const ids = Object.keys(state.chats);
    state.activeChatId = ids.length ? ids[ids.length - 1] : null;
  }
  save();
  renderHistory();
  renderMessages();
  updateWelcome();
}

function getActiveChat() {
  return state.activeChatId ? state.chats[state.activeChatId] : null;
}

// ── UI Renderers ───────────────────────────────
function renderHistory() {
  const list = els.historyList;
  const ids = Object.keys(state.chats).sort((a, b) =>
    state.chats[b].createdAt - state.chats[a].createdAt);

  if (!ids.length) {
    list.innerHTML = '<div class="history-empty">No chats yet. Start a new conversation!</div>';
    return;
  }

  list.innerHTML = ids.map(id => {
    const chat = state.chats[id];
    const active = id === state.activeChatId;
    return `
      <div class="history-item ${active ? 'active' : ''}" data-id="${id}">
        <span class="history-item-text">${escHtml(chat.title)}</span>
        <span class="history-item-time">${formatTime(chat.createdAt)}</span>
        <button class="history-item-del" data-del="${id}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }).join('');
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateWelcome() {
  const chat = getActiveChat();
  const hasMessages = chat && chat.messages.length > 0;
  els.welcomeScreen.style.display = hasMessages ? 'none' : 'flex';
  els.messages.style.display = hasMessages ? 'flex' : 'none';
}

function renderMessages() {
  const chat = getActiveChat();
  if (!chat) { els.messages.innerHTML = ''; return; }
  els.messages.innerHTML = chat.messages.map(m => buildMessageHTML(m)).join('');
  scrollToBottom();
}

function buildMessageHTML(msg) {
  const isUser = msg.role === 'user';
  const avatarLetter = isUser ? 'U' : 'Z';
  const label = isUser ? 'You' : agentPersonas[msg.agent || 'assistant'].name;
  const content = isUser ? `<p>${escHtml(msg.content)}</p>` : renderMarkdown(msg.content);

  return `
    <div class="message ${msg.role}" data-id="${msg.id}">
      <div class="msg-avatar">${avatarLetter}</div>
      <div class="msg-body">
        <div class="msg-name">${label}</div>
        <div class="msg-content">${content}</div>
        <div class="msg-actions">
          <button class="msg-action-btn" data-copy="${escHtml(msg.content)}" title="Copy">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function appendMessage(msg) {
  const div = document.createElement('div');
  div.innerHTML = buildMessageHTML(msg);
  const node = div.firstElementChild;
  els.messages.appendChild(node);
  scrollToBottom();
  return node;
}

function appendThinking() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'thinking-msg';
  div.innerHTML = `
    <div class="msg-avatar">Z</div>
    <div class="msg-body">
      <div class="msg-name">${agentPersonas[state.agent].name}</div>
      <div class="msg-content"><div class="thinking"><span></span><span></span><span></span></div></div>
    </div>`;
  els.messages.appendChild(div);
  scrollToBottom();
}

function removeThinking() {
  const el = document.getElementById('thinking-msg');
  if (el) el.remove();
}

function scrollToBottom() {
  els.chatArea.scrollTop = els.chatArea.scrollHeight;
}

// ── Input auto-resize ──────────────────────────
function resizeInput() {
  const el = els.chatInput;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

// ── Send Message ───────────────────────────────
async function sendMessage() {
  const text = els.chatInput.value.trim();
  if (!text || state.isLoading) return;

  if (!state.apiKey) {
    openSettings();
    toast('Add your Anthropic API key to start chatting.', 'error');
    return;
  }

  if (!state.activeChatId) {
    state.activeChatId = createChat();
    renderHistory();
  }

  const chat = getActiveChat();
  const userMsg = { id: `m_${Date.now()}`, role: 'user', content: text, agent: state.agent };
  chat.messages.push(userMsg);

  if (chat.messages.length === 1) {
    chat.title = text.slice(0, 46) + (text.length > 46 ? '…' : '');
    renderHistory();
  }

  els.chatInput.value = '';
  els.chatInput.style.height = 'auto';
  updateWelcome();
  appendMessage(userMsg);
  save();

  state.isLoading = true;
  setLoading(true);
  appendThinking();

  try {
    const reply = await callClaude(chat.messages);
    removeThinking();
    const assistantMsg = { id: `m_${Date.now()}`, role: 'assistant', content: reply, agent: state.agent };
    chat.messages.push(assistantMsg);
    appendMessage(assistantMsg);
    save();
    renderHistory();
  } catch (err) {
    removeThinking();
    const errMsg = {
      id: `m_${Date.now()}`,
      role: 'assistant',
      content: `**Error:** ${err.message || 'Something went wrong. Check your API key and try again.'}`,
      agent: state.agent,
    };
    chat.messages.push(errMsg);
    appendMessage(errMsg);
    toast(err.message || 'Request failed', 'error');
  } finally {
    state.isLoading = false;
    setLoading(false);
  }
}

function setLoading(loading) {
  els.sendBtn.disabled = loading || !els.chatInput.value.trim();
  if (loading) {
    els.sendBtn.classList.add('loading');
    els.sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="50"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>`;
  } else {
    els.sendBtn.classList.remove('loading');
    els.sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  }
}

// ── Anthropic API Call ─────────────────────────
async function callClaude(messages) {
  const persona = agentPersonas[state.agent];
  const systemText = state.systemPrompt + (persona.systemSuffix || '');
  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: state.model, max_tokens: 4096, system: systemText, messages: apiMessages }),
  });

  if (!response.ok) {
    let errText = `API error ${response.status}`;
    try { const body = await response.json(); errText = body?.error?.message || errText; } catch (_) {}
    throw new Error(errText);
  }

  const data = await response.json();
  const content = data?.content?.[0]?.text;
  if (!content) throw new Error('Empty response from API');
  return content;
}

// ── Settings ───────────────────────────────────
function openSettings() {
  els.apiKeyInput.value = state.apiKey;
  els.modelSelect.value = state.model;
  els.systemPrompt.value = state.systemPrompt;
  els.settingsModal.classList.add('open');
}

function closeSettingsModal() {
  els.settingsModal.classList.remove('open');
}

function saveSettingsAction() {
  state.apiKey = els.apiKeyInput.value.trim();
  state.model = els.modelSelect.value;
  state.systemPrompt = els.systemPrompt.value.trim();
  save();
  closeSettingsModal();
  syncPillModel();
  updateApiButton();
  toast('Settings saved!', 'success');
}

// Sync pill dropdown to state.model
function syncPillModel() {
  if (els.pillModelSelect) els.pillModelSelect.value = state.model;
}

// Update the "Add API" / "API Connected" button in topbar
function updateApiButton() {
  const connected = !!state.apiKey;
  els.apiDot.className = 'api-dot' + (connected ? ' connected' : '');
  els.apiLabel.textContent = connected ? 'API Connected' : 'Add API';
}

// ── Sidebar ─────────────────────────────────────
let sidebarCollapsed = false;

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  els.sidebar.classList.toggle('collapsed', sidebarCollapsed);
}

function toggleMobileSidebar() {
  els.sidebar.classList.toggle('mobile-open');
}

// ── Event Listeners ────────────────────────────
function initEvents() {
  els.sidebarToggle.addEventListener('click', toggleSidebar);
  els.mobileSidebarBtn.addEventListener('click', toggleMobileSidebar);

  els.newChatBtn.addEventListener('click', () => {
    const id = createChat();
    switchChat(id);
    save();
  });

  els.historyList.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) { e.stopPropagation(); deleteChat(delBtn.dataset.del); return; }
    const item = e.target.closest('[data-id]');
    if (item) switchChat(item.dataset.id);
  });

  document.querySelectorAll('.agent-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.agent-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.agent = tab.dataset.agent;
    });
  });

  els.chatInput.addEventListener('input', () => {
    resizeInput();
    els.sendBtn.disabled = !els.chatInput.value.trim() || state.isLoading;
  });

  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  els.sendBtn.addEventListener('click', sendMessage);

  els.clearChatBtn.addEventListener('click', () => {
    const chat = getActiveChat();
    if (!chat || !chat.messages.length) return;
    chat.messages = [];
    renderMessages();
    updateWelcome();
    save();
    toast('Chat cleared');
  });

  // Pill model selector syncs to state
  els.pillModelSelect.addEventListener('change', () => {
    state.model = els.pillModelSelect.value;
    els.modelSelect.value = state.model;
    save();
  });

  // Copy message
  els.messages.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.copy).then(() => {
      btn.classList.add('copied');
      toast('Copied to clipboard', 'success');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    });
  });

  // Settings
  els.openSettings.addEventListener('click', openSettings);
  els.topSettingsBtn.addEventListener('click', openSettings);
  els.closeSettings.addEventListener('click', closeSettingsModal);
  els.cancelSettings.addEventListener('click', closeSettingsModal);
  els.saveSettings.addEventListener('click', saveSettingsAction);
  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) closeSettingsModal();
  });

  els.toggleKey.addEventListener('click', () => {
    const isPass = els.apiKeyInput.type === 'password';
    els.apiKeyInput.type = isPass ? 'text' : 'password';
    els.toggleKey.textContent = isPass ? 'Hide' : 'Show';
  });
}

// ── Boot ───────────────────────────────────────
function init() {
  load();
  initEvents();
  syncPillModel();
  updateApiButton();

  els.apiKeyInput.value = state.apiKey;
  els.modelSelect.value = state.model;
  els.systemPrompt.value = state.systemPrompt;

  const ids = Object.keys(state.chats);
  if (ids.length) {
    state.activeChatId = ids.sort((a, b) => state.chats[b].createdAt - state.chats[a].createdAt)[0];
  }

  renderHistory();
  renderMessages();
  updateWelcome();
}

init();
