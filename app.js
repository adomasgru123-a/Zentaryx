'use strict';

// ── Supabase client ────────────────────────────
const { createClient } = window.supabase;
const db = createClient(
  window.ZENTARYX_CONFIG.supabaseUrl,
  window.ZENTARYX_CONFIG.supabaseAnonKey,
);

// ── Constants ──────────────────────────────────
const DEFAULT_SYSTEM_PROMPT =
  'You are Zentaryx, a helpful and knowledgeable AI assistant. Be concise, friendly, and accurate.';

const MODEL_LABELS = {
  'claude-sonnet-4-6':        'Claude Sonnet 4.6',
  'claude-opus-4-7':          'Claude Opus 4.7',
  'claude-haiku-4-5-20251001':'Claude Haiku 4.5',
};

const agentPersonas = {
  chatbot:    { name: 'Zentaryx', systemSuffix: '' },
  agent:      { name: 'Agent',    systemSuffix: ' You are an autonomous agent that breaks down tasks step by step and executes them methodically.' },
  automation: { name: 'Auto',     systemSuffix: ' You specialize in automation, scripting, and workflow optimization. Provide precise, runnable solutions.' },
};

// ── State ──────────────────────────────────────
const state = {
  user: null,
  apiKey: '',
  model: 'claude-sonnet-4-6',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  chats: {},
  activeChatId: null,
  agent: 'chatbot',
  isLoading: false,
};

// ── Settings — localStorage, namespaced per user ──
function settingsKey() { return `ztx_settings_${state.user?.id || 'anon'}`; }
function pinnedKey()   { return `ztx_pinned_${state.user?.id || 'anon'}`; }

function saveSettings() {
  localStorage.setItem(settingsKey(), JSON.stringify({
    apiKey:       state.apiKey,
    model:        state.model,
    systemPrompt: state.systemPrompt,
  }));
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(settingsKey()) || '{}');
    state.apiKey       = s.apiKey       || '';
    state.model        = s.model        || 'claude-sonnet-4-6';
    state.systemPrompt = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  } catch (_) {}
}

function getPinnedIds() {
  try { return JSON.parse(localStorage.getItem(pinnedKey()) || '[]'); } catch (_) { return []; }
}

function setPinnedIds(ids) {
  localStorage.setItem(pinnedKey(), JSON.stringify(ids));
}

function togglePin(chatId) {
  const ids = getPinnedIds();
  const idx = ids.indexOf(chatId);
  if (idx === -1) ids.push(chatId); else ids.splice(idx, 1);
  setPinnedIds(ids);
}

// ── Supabase DB helpers ────────────────────────
async function dbLoadChats() {
  const { data, error } = await db
    .from('chats')
    .select('id, title, agent, created_at')
    .eq('user_id', state.user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  state.chats = {};
  for (const row of data || []) {
    state.chats[row.id] = {
      id: row.id, title: row.title, agent: row.agent,
      createdAt: new Date(row.created_at).getTime(),
      messages: [], messagesLoaded: false,
    };
  }
}

async function dbLoadMessages(chatId) {
  const { data, error } = await db
    .from('messages')
    .select('id, role, content, agent')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const chat = state.chats[chatId];
  if (chat) {
    chat.messages = (data || []).map(r => ({
      id: r.id, role: r.role, content: r.content, agent: r.agent,
    }));
    chat.messagesLoaded = true;
  }
}

async function dbCreateChat(agent) {
  const { data, error } = await db
    .from('chats')
    .insert({ user_id: state.user.id, title: 'New Chat', agent })
    .select()
    .single();

  if (error) throw error;

  state.chats[data.id] = {
    id: data.id, title: data.title, agent: data.agent,
    createdAt: new Date(data.created_at).getTime(),
    messages: [], messagesLoaded: true,
  };
  return data.id;
}

async function dbUpdateChatTitle(chatId, title) {
  const { error } = await db.from('chats').update({ title }).eq('id', chatId);
  if (error) console.error('Failed to update title', error);
}

async function dbSaveMessage(chatId, role, content, agent) {
  const { data, error } = await db
    .from('messages')
    .insert({ chat_id: chatId, role, content, agent })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function dbDeleteChat(chatId) {
  const { error } = await db.from('chats').delete().eq('id', chatId);
  if (error) throw error;
}

async function dbClearMessages(chatId) {
  const { error } = await db.from('messages').delete().eq('chat_id', chatId);
  if (error) throw error;
}

// ── DOM refs ───────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  // screens
  loadingScreen: $('loadingScreen'),
  loginScreen:   $('loginScreen'),
  app:           $('app'),
  googleSignIn:  $('googleSignIn'),
  // sidebar
  sidebar:          $('sidebar'),
  sidebarToggle:    $('sidebarToggle'),
  mobileSidebarBtn: $('mobileSidebarBtn'),
  newChatBtn:       $('newChatBtn'),
  projectsBtn:      $('projectsBtn'),
  moreBtn:          $('moreBtn'),
  historyList:      $('historyList'),
  // user chip
  userAvatarImg:    $('userAvatarImg'),
  userName:         $('userName'),
  userEmailDisplay: $('userEmailDisplay'),
  logoutBtn:        $('logoutBtn'),
  // main
  main:            $('main'),
  chatArea:        $('chatArea'),
  welcomeScreen:   $('welcomeScreen'),
  welcomeInputSlot:$('welcomeInputSlot'),
  messages:        $('messages'),
  inputArea:       $('inputArea'),
  chatInput:       $('chatInput'),
  sendBtn:         $('sendBtn'),
  clearChatBtn:    $('clearChatBtn'),
  pillModelSelect: $('pillModelSelect'),
  connDot:         $('connDot'),
  connLabel:       $('connLabel'),
  topSettingsBtn:  $('topSettingsBtn'),
  // settings modal
  settingsModal:  $('settingsModal'),
  closeSettings:  $('closeSettings'),
  cancelSettings: $('cancelSettings'),
  saveSettings:   $('saveSettings'),
  apiKeyInput:    $('apiKeyInput'),
  modelSelect:    $('modelSelect'),
  systemPrompt:   $('systemPrompt'),
  toggleKey:      $('toggleKey'),
  // context menu
  ctxMenu:      $('ctxMenu'),
  ctxPin:       $('ctxPin'),
  ctxPinLabel:  $('ctxPinLabel'),
  ctxRename:    $('ctxRename'),
  ctxDelete:    $('ctxDelete'),
};

// ── Toast ──────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Markdown renderer ──────────────────────────
function renderMarkdown(text) {
  let html = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_,lang,code) => `<pre><code class="language-${lang}">${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>')
    .replace(/^\s*[-*] (.+)$/gm,'<li>$1</li>')
    .replace(/^\s*\d+\. (.+)$/gm,'<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`)
    .replace(/\n\n+/g,'</p><p>')
    .replace(/\n/g,'<br>');
  return `<p>${html}</p>`
    .replace(/<p><\/p>/g,'')
    .replace(/<p>(<pre>|<h[1-3]>|<ul>|<blockquote>)/g,'$1')
    .replace(/(<\/pre>|<\/h[1-3]>|<\/ul>|<\/blockquote>)<\/p>/g,'$1');
}

// ── Layout helpers ─────────────────────────────
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString([],{month:'short',day:'numeric'});
}

function getActiveChat() {
  return state.activeChatId ? state.chats[state.activeChatId] : null;
}

function updateLayout() {
  const chat = getActiveChat();
  const hasMessages = !!(chat && chat.messages.length > 0);

  if (hasMessages) {
    els.welcomeScreen.style.display = 'none';
    els.messages.style.display = 'flex';
    if (els.inputArea.parentNode !== els.main) els.main.appendChild(els.inputArea);
  } else {
    els.welcomeScreen.style.display = 'flex';
    els.messages.style.display = 'none';
    if (els.inputArea.parentNode !== els.welcomeInputSlot) els.welcomeInputSlot.appendChild(els.inputArea);
  }
}

function scrollToBottom() { els.chatArea.scrollTop = els.chatArea.scrollHeight; }

function resizeInput() {
  const el = els.chatInput;
  el.style.height = 'auto';
  // 3 lines max: ~21px per line × 3 + top/bottom padding ≈ 73px
  el.style.height = Math.min(el.scrollHeight, 73) + 'px';
}

// ── History ────────────────────────────────────
function renderHistory() {
  const pinned = getPinnedIds();
  const pinnedSet = new Set(pinned);

  const all = Object.keys(state.chats);
  if (!all.length) { els.historyList.innerHTML = '<div class="history-empty">No chats yet.</div>'; return; }

  // Pinned first, then rest sorted by createdAt desc
  const sorted = [
    ...pinned.filter(id => state.chats[id]),
    ...all.filter(id => !pinnedSet.has(id)).sort((a,b) => state.chats[b].createdAt - state.chats[a].createdAt),
  ];

  const pinSvg = `<svg class="pin-icon" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M16 4v6l2 2-6 6-2-6H4l2-2 6-2V4h4z"/></svg>`;

  els.historyList.innerHTML = sorted.map(id => {
    const c = state.chats[id];
    const isPinned = pinnedSet.has(id);
    return `<div class="history-item ${id===state.activeChatId?'active':''} ${isPinned?'pinned':''}" data-id="${id}">
      ${isPinned ? pinSvg : ''}
      <span class="history-item-text">${escHtml(c.title)}</span>
      <span class="history-item-time">${formatTime(c.createdAt)}</span>
    </div>`;
  }).join('');
}

// ── Context menu ───────────────────────────────
let ctxTargetId = null;

function showCtxMenu(e, chatId) {
  e.preventDefault();
  ctxTargetId = chatId;
  const pinned = getPinnedIds();
  els.ctxPinLabel.textContent = pinned.includes(chatId) ? 'Unpin' : 'Pin';
  els.ctxMenu.style.left = e.clientX + 'px';
  els.ctxMenu.style.top  = e.clientY + 'px';
  els.ctxMenu.classList.add('open');
}

function hideCtxMenu() {
  els.ctxMenu.classList.remove('open');
  ctxTargetId = null;
}

// ── Rename ─────────────────────────────────────
function startRename(chatId) {
  const item = els.historyList.querySelector(`[data-id="${chatId}"]`);
  if (!item) return;
  const textSpan = item.querySelector('.history-item-text');
  if (!textSpan) return;

  const chat = state.chats[chatId];
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = chat.title;

  textSpan.replaceWith(input);
  input.focus();
  input.select();

  async function commitRename() {
    const newTitle = input.value.trim() || chat.title;
    chat.title = newTitle;
    await dbUpdateChatTitle(chatId, newTitle);
    renderHistory();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = chat.title; input.blur(); }
  });
  input.addEventListener('blur', commitRename, { once: true });
}

// ── Messages ───────────────────────────────────
function buildMessageHTML(msg) {
  const isUser = msg.role === 'user';
  const agentKey = (msg.agent && agentPersonas[msg.agent]) ? msg.agent : 'chatbot';
  const label  = isUser ? 'You' : agentPersonas[agentKey].name;
  const content= isUser ? `<p>${escHtml(msg.content)}</p>` : renderMarkdown(msg.content);
  return `<div class="message ${msg.role}" data-id="${msg.id}">
    <div class="msg-avatar">${isUser?'U':'Z'}</div>
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

function renderMessages() {
  const chat = getActiveChat();
  if (!chat) { els.messages.innerHTML = ''; return; }
  els.messages.innerHTML = chat.messages.map(buildMessageHTML).join('');
  scrollToBottom();
}

function appendMessage(msg) {
  const div = document.createElement('div');
  div.innerHTML = buildMessageHTML(msg);
  els.messages.appendChild(div.firstElementChild);
  scrollToBottom();
}

function appendThinking() {
  const agentKey = agentPersonas[state.agent] ? state.agent : 'chatbot';
  const div = document.createElement('div');
  div.className = 'message assistant'; div.id = 'thinking-msg';
  div.innerHTML = `<div class="msg-avatar">Z</div>
    <div class="msg-body">
      <div class="msg-name">${agentPersonas[agentKey].name}</div>
      <div class="msg-content"><div class="thinking"><span></span><span></span><span></span></div></div>
    </div>`;
  els.messages.appendChild(div);
  scrollToBottom();
}

function removeThinking() { const el = $('thinking-msg'); if (el) el.remove(); }

// ── Chat switching ─────────────────────────────
async function switchChat(id) {
  if (state.activeChatId === id) return;
  state.activeChatId = id;
  renderHistory();

  const chat = state.chats[id];
  if (!chat) return;

  if (!chat.messagesLoaded) {
    els.welcomeScreen.style.display = 'none';
    els.messages.innerHTML = '<div class="msgs-loading"><div class="thinking"><span></span><span></span><span></span></div></div>';
    els.messages.style.display = 'flex';
    if (els.inputArea.parentNode !== els.main) els.main.appendChild(els.inputArea);

    try { await dbLoadMessages(id); } catch (err) { toast('Failed to load messages: ' + err.message, 'error'); }
  }

  renderMessages();
  updateLayout();
}

async function deleteChat(id) {
  try { await dbDeleteChat(id); } catch (err) { toast('Delete failed: ' + err.message, 'error'); return; }

  // Remove from pinned if present
  const pinned = getPinnedIds().filter(p => p !== id);
  setPinnedIds(pinned);

  delete state.chats[id];
  if (state.activeChatId === id) {
    const ids = Object.keys(state.chats);
    state.activeChatId = ids.length
      ? ids.sort((a,b) => state.chats[b].createdAt - state.chats[a].createdAt)[0]
      : null;
    if (state.activeChatId) await dbLoadMessages(state.activeChatId);
  }
  renderHistory();
  renderMessages();
  updateLayout();
}

// ── Loading states ─────────────────────────────
function setLoading(loading) {
  els.sendBtn.disabled = loading || !els.chatInput.value.trim();
  els.sendBtn.classList.toggle('loading', loading);
  els.sendBtn.innerHTML = loading
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="50"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
}

// ── Send message ───────────────────────────────
async function sendMessage() {
  const text = els.chatInput.value.trim();
  if (!text || state.isLoading) return;
  if (!state.apiKey) { openSettings(); toast('Add your Anthropic API key first.', 'error'); return; }

  if (!state.activeChatId) {
    try {
      state.activeChatId = await dbCreateChat(state.agent);
      renderHistory();
    } catch (err) { toast('Could not create chat: ' + err.message, 'error'); return; }
  }

  const chat = getActiveChat();

  els.chatInput.value = '';
  els.chatInput.style.height = 'auto';

  state.isLoading = true;
  setLoading(true);

  try {
    const userMsgId = await dbSaveMessage(state.activeChatId, 'user', text, state.agent);
    const userMsg = { id: userMsgId, role: 'user', content: text, agent: state.agent };

    if (chat.messages.length === 0) {
      const title = text.slice(0, 46) + (text.length > 46 ? '…' : '');
      await dbUpdateChatTitle(state.activeChatId, title);
      chat.title = title;
      renderHistory();
    }

    chat.messages.push(userMsg);
    updateLayout();
    appendMessage(userMsg);
    appendThinking();

    const reply = await callClaude(chat.messages);
    removeThinking();

    const asstMsgId = await dbSaveMessage(state.activeChatId, 'assistant', reply, state.agent);
    const asstMsg = { id: asstMsgId, role: 'assistant', content: reply, agent: state.agent };
    chat.messages.push(asstMsg);
    appendMessage(asstMsg);
    renderHistory();

  } catch (err) {
    removeThinking();
    const errMsg = {
      id: `err_${Date.now()}`, role: 'assistant', agent: state.agent,
      content: `**Error:** ${err.message || 'Something went wrong. Check your API key.'}`,
    };
    const chat2 = getActiveChat();
    if (chat2) chat2.messages.push(errMsg);
    appendMessage(errMsg);
    toast(err.message || 'Request failed', 'error');
  } finally {
    state.isLoading = false;
    setLoading(false);
  }
}

// ── Anthropic API ──────────────────────────────
async function callClaude(messages) {
  const agentKey = agentPersonas[state.agent] ? state.agent : 'chatbot';
  const persona = agentPersonas[agentKey];
  const systemText = state.systemPrompt + (persona.systemSuffix || '');
  const apiMessages = messages
    .filter(m => !m.id?.startsWith('err_'))
    .map(m => ({ role: m.role, content: m.content }));

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

// ── Settings modal ─────────────────────────────
function openSettings() {
  els.apiKeyInput.value  = state.apiKey;
  els.modelSelect.value  = state.model;
  els.systemPrompt.value = state.systemPrompt;
  els.settingsModal.classList.add('open');
}

function closeSettingsModal() { els.settingsModal.classList.remove('open'); }

function saveSettingsAction() {
  state.apiKey       = els.apiKeyInput.value.trim();
  state.model        = els.modelSelect.value;
  state.systemPrompt = els.systemPrompt.value.trim();
  saveSettings();
  closeSettingsModal();
  els.pillModelSelect.value = state.model;
  updateConnectionBadge();
  toast('Settings saved!', 'success');
}

function updateConnectionBadge() {
  const connected = !!state.apiKey;
  els.connDot.className    = 'conn-dot' + (connected ? ' active' : '');
  els.connLabel.textContent = connected
    ? `Connected: ${MODEL_LABELS[state.model] || state.model}`
    : 'Not connected';
}

// ── Auth ───────────────────────────────────────
async function signInWithGoogle() {
  els.googleSignIn.disabled = true;
  els.googleSignIn.textContent = 'Redirecting…';
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) {
    toast(error.message, 'error');
    els.googleSignIn.disabled = false;
    els.googleSignIn.textContent = 'Continue with Google';
  }
}

async function signOut() { await db.auth.signOut(); }

function updateUserDisplay(user) {
  const meta = user.user_metadata || {};
  const name  = meta.full_name || meta.name || user.email?.split('@')[0] || 'User';
  const email = user.email || '';
  const avatar= meta.avatar_url || meta.picture || '';

  els.userName.textContent         = name;
  els.userEmailDisplay.textContent = email;

  if (avatar) {
    els.userAvatarImg.src = avatar;
    els.userAvatarImg.style.display = 'block';
  } else {
    els.userAvatarImg.style.display = 'none';
  }
}

async function onLogin(user) {
  state.user = user;
  loadSettings();
  updateUserDisplay(user);

  try { await dbLoadChats(); } catch (err) { toast('Failed to load chats: ' + err.message, 'error'); }

  const ids = Object.keys(state.chats);
  if (ids.length) {
    state.activeChatId = ids[0];
    try { await dbLoadMessages(state.activeChatId); } catch (_) {}
  }

  els.loadingScreen.style.display = 'none';
  els.loginScreen.style.display   = 'none';
  els.app.style.display           = 'flex';

  els.pillModelSelect.value = state.model;
  els.apiKeyInput.value     = state.apiKey;
  els.modelSelect.value     = state.model;
  els.systemPrompt.value    = state.systemPrompt;
  updateConnectionBadge();
  renderHistory();
  renderMessages();
  updateLayout();
}

function onSignOut() {
  state.user = null;
  state.chats = {};
  state.activeChatId = null;
  els.app.style.display           = 'none';
  els.loadingScreen.style.display = 'none';
  els.loginScreen.style.display   = 'flex';
}

// ── Sidebar ────────────────────────────────────
let sidebarCollapsed = false;
function toggleSidebar()       { sidebarCollapsed = !sidebarCollapsed; els.sidebar.classList.toggle('collapsed', sidebarCollapsed); }
function toggleMobileSidebar() { els.sidebar.classList.toggle('mobile-open'); }

// ── Events ─────────────────────────────────────
function initEvents() {
  // Auth
  els.googleSignIn.addEventListener('click', signInWithGoogle);
  els.logoutBtn.addEventListener('click', signOut);

  // Sidebar
  els.sidebarToggle.addEventListener('click', toggleSidebar);
  els.mobileSidebarBtn.addEventListener('click', toggleMobileSidebar);

  els.newChatBtn.addEventListener('click', () => {
    state.activeChatId = null;
    renderHistory();
    renderMessages();
    updateLayout();
  });

  els.projectsBtn.addEventListener('click', () => toast('Projects — coming soon', ''));
  els.moreBtn.addEventListener('click',     () => toast('More — coming soon', ''));

  // History clicks
  els.historyList.addEventListener('click', e => {
    if (e.target.closest('.rename-input')) return;
    const item = e.target.closest('[data-id]');
    if (item) switchChat(item.dataset.id);
  });

  // Right-click context menu on history items
  els.historyList.addEventListener('contextmenu', e => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    showCtxMenu(e, item.dataset.id);
  });

  // Context menu actions
  els.ctxPin.addEventListener('click', () => {
    if (!ctxTargetId) return;
    togglePin(ctxTargetId);
    renderHistory();
    hideCtxMenu();
  });

  els.ctxRename.addEventListener('click', () => {
    const id = ctxTargetId;
    hideCtxMenu();
    if (id) startRename(id);
  });

  els.ctxDelete.addEventListener('click', () => {
    const id = ctxTargetId;
    hideCtxMenu();
    if (id) deleteChat(id);
  });

  // Hide context menu on outside click or Escape
  document.addEventListener('click', e => {
    if (!els.ctxMenu.contains(e.target)) hideCtxMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideCtxMenu();
  });

  // Agent tabs
  document.querySelectorAll('.agent-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.agent-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.agent = tab.dataset.agent;
    });
  });

  // Input
  els.chatInput.addEventListener('input', () => {
    resizeInput();
    els.sendBtn.disabled = !els.chatInput.value.trim() || state.isLoading;
  });
  els.chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  els.sendBtn.addEventListener('click', sendMessage);

  // Clear chat
  els.clearChatBtn.addEventListener('click', async () => {
    const chat = getActiveChat();
    if (!chat || !chat.messages.length) return;
    try {
      await dbClearMessages(state.activeChatId);
      chat.messages = [];
      chat.messagesLoaded = true;
      renderMessages();
      updateLayout();
      toast('Chat cleared');
    } catch (err) { toast('Failed to clear: ' + err.message, 'error'); }
  });

  // Pill model selector
  els.pillModelSelect.addEventListener('change', () => {
    state.model = els.pillModelSelect.value;
    els.modelSelect.value = state.model;
    updateConnectionBadge();
    saveSettings();
  });

  // Copy message
  els.messages.addEventListener('click', e => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.copy).then(() => {
      btn.classList.add('copied');
      toast('Copied!', 'success');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    });
  });

  // Settings modal
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
let appInitialized = false;

async function init() {
  initEvents();

  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user && !appInitialized) {
      appInitialized = true;
      await onLogin(session.user);
    } else if (event === 'SIGNED_OUT') {
      appInitialized = false;
      onSignOut();
    }
  });

  const { data: { session } } = await db.auth.getSession();
  if (session?.user && !appInitialized) {
    appInitialized = true;
    await onLogin(session.user);
  } else if (!session) {
    els.loadingScreen.style.display = 'none';
    els.loginScreen.style.display   = 'flex';
  }
}

init();
