'use strict';

// ── State ──────────────────────────────────────
const state = {
  apiKey: '',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are Zentaryx, a helpful and knowledgeable AI assistant. Be concise, friendly, and accurate.',
  chats: {},
  activeChatId: null,
  agent: 'assistant',
  mode: 'chatbot',
  isLoading: false,
};

const MODEL_LABELS = {
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
};

const agentPersonas = {
  assistant: { name: 'Zentaryx', systemSuffix: '' },
  coder: { name: 'Coder', systemSuffix: ' You specialize in programming. Provide clean code with explanations.' },
  analyst: { name: 'Analyst', systemSuffix: ' You specialize in data analysis and structured reasoning. Use bullet points and logical breakdowns.' },
};

// ── Persistence ────────────────────────────────
function save() {
  try {
    localStorage.setItem('zentaryx_chats', JSON.stringify(state.chats));
    localStorage.setItem('zentaryx_settings', JSON.stringify({
      apiKey: state.apiKey, model: state.model, systemPrompt: state.systemPrompt,
    }));
  } catch (_) {}
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem('zentaryx_settings') || '{}');
    state.apiKey = s.apiKey || '';
    state.model = s.model || 'claude-sonnet-4-6';
    state.systemPrompt = s.systemPrompt || state.systemPrompt;
    state.chats = JSON.parse(localStorage.getItem('zentaryx_chats') || '{}');
  } catch (_) {}
}

// ── DOM Refs ───────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  sidebar: $('sidebar'),
  sidebarToggle: $('sidebarToggle'),
  mobileSidebarBtn: $('mobileSidebarBtn'),
  newChatBtn: $('newChatBtn'),
  historyList: $('historyList'),
  chatArea: $('chatArea'),
  welcomeScreen: $('welcomeScreen'),
  welcomeInputSlot: $('welcomeInputSlot'),
  messages: $('messages'),
  main: $('main'),
  inputArea: $('inputArea'),
  chatInput: $('chatInput'),
  sendBtn: $('sendBtn'),
  clearChatBtn: $('clearChatBtn'),
  pillModelSelect: $('pillModelSelect'),
  connDot: $('connDot'),
  connLabel: $('connLabel'),
  topSettingsBtn: $('topSettingsBtn'),
  settingsModal: $('settingsModal'),
  openSettings: $('openSettings'),
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
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Markdown renderer ──────────────────────────
function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="language-${lang}">${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`)
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
  updateLayout();
}

function deleteChat(id) {
  delete state.chats[id];
  if (state.activeChatId === id) {
    const ids = Object.keys(state.chats);
    state.activeChatId = ids.length ? ids.sort((a, b) => state.chats[b].createdAt - state.chats[a].createdAt)[0] : null;
  }
  save(); renderHistory(); renderMessages(); updateLayout();
}

function getActiveChat() {
  return state.activeChatId ? state.chats[state.activeChatId] : null;
}

// ── Layout — move input between welcome & bottom ──
function updateLayout() {
  const chat = getActiveChat();
  const hasMessages = !!(chat && chat.messages.length > 0);
  const inputArea = els.inputArea;
  const slot = els.welcomeInputSlot;
  const main = els.main;

  if (hasMessages) {
    // Chat mode: input at bottom of main
    els.welcomeScreen.style.display = 'none';
    els.messages.style.display = 'flex';
    if (inputArea.parentNode !== main) main.appendChild(inputArea);
  } else {
    // Welcome mode: input inside welcome screen slot
    els.welcomeScreen.style.display = 'flex';
    els.messages.style.display = 'none';
    if (inputArea.parentNode !== slot) slot.appendChild(inputArea);
  }
}

// ── History ────────────────────────────────────
function renderHistory() {
  const ids = Object.keys(state.chats).sort((a, b) => state.chats[b].createdAt - state.chats[a].createdAt);
  if (!ids.length) { els.historyList.innerHTML = '<div class="history-empty">No chats yet.</div>'; return; }

  els.historyList.innerHTML = ids.map(id => {
    const chat = state.chats[id];
    return `
      <div class="history-item ${id === state.activeChatId ? 'active' : ''}" data-id="${id}">
        <span class="history-item-text">${escHtml(chat.title)}</span>
        <span class="history-item-time">${formatTime(chat.createdAt)}</span>
        <button class="history-item-del" data-del="${id}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }).join('');
}

function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Messages ───────────────────────────────────
function renderMessages() {
  const chat = getActiveChat();
  if (!chat) { els.messages.innerHTML = ''; return; }
  els.messages.innerHTML = chat.messages.map(buildMessageHTML).join('');
  scrollToBottom();
}

function buildMessageHTML(msg) {
  const isUser = msg.role === 'user';
  const label = isUser ? 'You' : agentPersonas[msg.agent || 'assistant'].name;
  const content = isUser ? `<p>${escHtml(msg.content)}</p>` : renderMarkdown(msg.content);
  return `
    <div class="message ${msg.role}" data-id="${msg.id}">
      <div class="msg-avatar">${isUser ? 'U' : 'Z'}</div>
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
  els.messages.appendChild(div.firstElementChild);
  scrollToBottom();
}

function appendThinking() {
  const div = document.createElement('div');
  div.className = 'message assistant'; div.id = 'thinking-msg';
  div.innerHTML = `
    <div class="msg-avatar">Z</div>
    <div class="msg-body">
      <div class="msg-name">${agentPersonas[state.agent].name}</div>
      <div class="msg-content"><div class="thinking"><span></span><span></span><span></span></div></div>
    </div>`;
  els.messages.appendChild(div);
  scrollToBottom();
}

function removeThinking() { const el = $('thinking-msg'); if (el) el.remove(); }
function scrollToBottom() { els.chatArea.scrollTop = els.chatArea.scrollHeight; }

// ── Input resize ───────────────────────────────
function resizeInput() {
  const el = els.chatInput;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

// ── Send ───────────────────────────────────────
async function sendMessage() {
  const text = els.chatInput.value.trim();
  if (!text || state.isLoading) return;

  if (!state.apiKey) { openSettings(); toast('Add your API key to start chatting.', 'error'); return; }

  if (!state.activeChatId) { state.activeChatId = createChat(); renderHistory(); }

  const chat = getActiveChat();
  const userMsg = { id: `m_${Date.now()}`, role: 'user', content: text, agent: state.agent };
  chat.messages.push(userMsg);
  if (chat.messages.length === 1) { chat.title = text.slice(0, 46) + (text.length > 46 ? '…' : ''); renderHistory(); }

  els.chatInput.value = ''; els.chatInput.style.height = 'auto';
  updateLayout();       // moves input to bottom before we append messages
  appendMessage(userMsg);
  save();

  state.isLoading = true; setLoading(true); appendThinking();

  try {
    const reply = await callClaude(chat.messages);
    removeThinking();
    const asst = { id: `m_${Date.now()}`, role: 'assistant', content: reply, agent: state.agent };
    chat.messages.push(asst);
    appendMessage(asst);
    save(); renderHistory();
  } catch (err) {
    removeThinking();
    const errMsg = { id: `m_${Date.now()}`, role: 'assistant', content: `**Error:** ${err.message || 'Something went wrong.'}`, agent: state.agent };
    chat.messages.push(errMsg);
    appendMessage(errMsg);
    toast(err.message || 'Request failed', 'error');
  } finally {
    state.isLoading = false; setLoading(false);
  }
}

function setLoading(loading) {
  els.sendBtn.disabled = loading || !els.chatInput.value.trim();
  els.sendBtn.classList.toggle('loading', loading);
  els.sendBtn.innerHTML = loading
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="50"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
}

// ── API Call ───────────────────────────────────
async function callClaude(messages) {
  const persona = agentPersonas[state.agent];
  const systemText = state.systemPrompt + (persona.systemSuffix || '');
  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: state.model, max_tokens: 4096, system: systemText, messages: apiMessages }),
  });

  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try { const b = await res.json(); msg = b?.error?.message || msg; } catch (_) {}
    throw new Error(msg);
  }

  const data = await res.json();
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

function closeSettingsModal() { els.settingsModal.classList.remove('open'); }

function saveSettingsAction() {
  state.apiKey = els.apiKeyInput.value.trim();
  state.model = els.modelSelect.value;
  state.systemPrompt = els.systemPrompt.value.trim();
  save();
  closeSettingsModal();
  els.pillModelSelect.value = state.model;
  updateConnectionBadge();
  toast('Settings saved!', 'success');
}

// ── Connection badge ───────────────────────────
function updateConnectionBadge() {
  const connected = !!state.apiKey;
  els.connDot.className = 'conn-dot' + (connected ? ' active' : '');
  els.connLabel.textContent = connected ? `Connected: ${MODEL_LABELS[state.model] || state.model}` : 'Not connected';
}

// ── Sidebar ────────────────────────────────────
let sidebarCollapsed = false;
function toggleSidebar() { sidebarCollapsed = !sidebarCollapsed; els.sidebar.classList.toggle('collapsed', sidebarCollapsed); }
function toggleMobileSidebar() { els.sidebar.classList.toggle('mobile-open'); }

// ── Events ─────────────────────────────────────
function initEvents() {
  els.sidebarToggle.addEventListener('click', toggleSidebar);
  els.mobileSidebarBtn.addEventListener('click', toggleMobileSidebar);

  els.newChatBtn.addEventListener('click', () => { const id = createChat(); switchChat(id); save(); });

  els.historyList.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteChat(del.dataset.del); return; }
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

  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.mode = tab.dataset.mode;
    });
  });

  els.chatInput.addEventListener('input', () => {
    resizeInput();
    els.sendBtn.disabled = !els.chatInput.value.trim() || state.isLoading;
  });

  els.chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  els.sendBtn.addEventListener('click', sendMessage);

  els.clearChatBtn.addEventListener('click', () => {
    const chat = getActiveChat();
    if (!chat || !chat.messages.length) return;
    chat.messages = [];
    renderMessages(); updateLayout(); save();
    toast('Chat cleared');
  });

  els.pillModelSelect.addEventListener('change', () => {
    state.model = els.pillModelSelect.value;
    els.modelSelect.value = state.model;
    updateConnectionBadge();
    save();
  });

  els.messages.addEventListener('click', e => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.copy).then(() => {
      btn.classList.add('copied');
      toast('Copied!', 'success');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    });
  });

  els.openSettings.addEventListener('click', openSettings);
  els.topSettingsBtn.addEventListener('click', openSettings);
  els.closeSettings.addEventListener('click', closeSettingsModal);
  els.cancelSettings.addEventListener('click', closeSettingsModal);
  els.saveSettings.addEventListener('click', saveSettingsAction);
  els.settingsModal.addEventListener('click', e => { if (e.target === els.settingsModal) closeSettingsModal(); });

  els.toggleKey.addEventListener('click', () => {
    const show = els.apiKeyInput.type === 'password';
    els.apiKeyInput.type = show ? 'text' : 'password';
    els.toggleKey.textContent = show ? 'Hide' : 'Show';
  });
}

// ── Boot ───────────────────────────────────────
function init() {
  load();
  initEvents();

  els.pillModelSelect.value = state.model;
  els.apiKeyInput.value = state.apiKey;
  els.modelSelect.value = state.model;
  els.systemPrompt.value = state.systemPrompt;

  updateConnectionBadge();

  const ids = Object.keys(state.chats);
  if (ids.length) {
    state.activeChatId = ids.sort((a, b) => state.chats[b].createdAt - state.chats[a].createdAt)[0];
  }

  renderHistory();
  renderMessages();
  updateLayout();
}

init();
