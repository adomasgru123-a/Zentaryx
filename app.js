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
  agent:      { name: 'Agent',    systemSuffix: ' You are an autonomous agent. Break tasks into steps and execute them methodically.' },
  automation: { name: 'Auto',     systemSuffix: ' You specialize in automation, scripting, and workflow optimization.' },
};

const AGENT_NAV = [
  { id: 'general',         label: 'General' },
  { id: 'apps',            label: 'Apps' },
  { id: 'apis',            label: 'APIs' },
  { id: 'files',           label: 'Files' },
  { id: 'skills',          label: 'Skills' },
  { id: 'roles',           label: 'Roles' },
  { id: 'agent',           label: 'Agent' },
  { id: 'settings',        label: 'Settings' },
  { id: 'config',          label: 'Config' },
  { id: 'personalization', label: 'Personalization' },
];

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

// View state (not persisted)
let currentView = 'chat';
let selectedAgentId = null;
let selectedAgentSection = 'general';

// ── Settings — localStorage, namespaced per user ──
function settingsKey() { return `ztx_settings_${state.user?.id || 'anon'}`; }
function pinnedKey()   { return `ztx_pinned_${state.user?.id || 'anon'}`; }
function agentsKey()   { return `ztx_agents_${state.user?.id || 'anon'}`; }

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
function setPinnedIds(ids) { localStorage.setItem(pinnedKey(), JSON.stringify(ids)); }

function togglePin(chatId) {
  const ids = getPinnedIds();
  const idx = ids.indexOf(chatId);
  if (idx === -1) ids.push(chatId); else ids.splice(idx, 1);
  setPinnedIds(ids);
}

function loadAgents() {
  try { return JSON.parse(localStorage.getItem(agentsKey()) || '[]'); } catch (_) { return []; }
}
function saveAgents(agents) { localStorage.setItem(agentsKey(), JSON.stringify(agents)); }

function createNewAgent(data) {
  const agents = loadAgents();
  const agent = {
    id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`),
    title: data.title,
    username: data.username,
    description: data.description,
    api: data.api,
    type: data.type,
    createdAt: Date.now(),
  };
  agents.unshift(agent);
  saveAgents(agents);
  return agent;
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
    .from('messages').select('id, role, content, agent')
    .eq('chat_id', chatId).order('created_at', { ascending: true });
  if (error) throw error;
  const chat = state.chats[chatId];
  if (chat) {
    chat.messages = (data || []).map(r => ({ id: r.id, role: r.role, content: r.content, agent: r.agent }));
    chat.messagesLoaded = true;
  }
}

async function dbCreateChat(agent) {
  const { data, error } = await db
    .from('chats').insert({ user_id: state.user.id, title: 'New Chat', agent })
    .select().single();
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
    .from('messages').insert({ chat_id: chatId, role, content, agent })
    .select('id').single();
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
  // main / chat
  main:            $('main'),
  chatArea:        $('chatArea'),
  welcomeScreen:   $('welcomeScreen'),
  welcomeInputSlot:$('welcomeInputSlot'),
  messages:        $('messages'),
  inputArea:       $('inputArea'),
  chatInput:       $('chatInput'),
  sendBtn:         $('sendBtn'),
  // topbar
  chatTopbarActions:   $('chatTopbarActions'),
  agentsTopbarActions: $('agentsTopbarActions'),
  clearChatBtn:        $('clearChatBtn'),
  pillModelSelect:     $('pillModelSelect'),
  connDot:             $('connDot'),
  connLabel:           $('connLabel'),
  topSettingsBtn:      $('topSettingsBtn'),
  // agents view
  agentsView:          $('agentsView'),
  agentsListScreen:    $('agentsListScreen'),
  agentsEmpty:         $('agentsEmpty'),
  agentsGrid:          $('agentsGrid'),
  agentDetail:         $('agentDetail'),
  agentDetailNav:      $('agentDetailNav'),
  agentDetailContent:  $('agentDetailContent'),
  addAgentBtn:         $('addAgentBtn'),
  // add-agent modal
  addAgentModal:       $('addAgentModal'),
  closeAddAgent:       $('closeAddAgent'),
  cancelAddAgent:      $('cancelAddAgent'),
  createAgentBtn:      $('createAgentBtn'),
  newAgentTitle:       $('newAgentTitle'),
  newAgentUsername:    $('newAgentUsername'),
  newAgentDescription: $('newAgentDescription'),
  newAgentApi:         $('newAgentApi'),
  newAgentType:        $('newAgentType'),
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
  ctxMenu:     $('ctxMenu'),
  ctxPin:      $('ctxPin'),
  ctxPinLabel: $('ctxPinLabel'),
  ctxRename:   $('ctxRename'),
  ctxDelete:   $('ctxDelete'),
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

// ── Helpers ────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString([],{month:'short',day:'numeric'});
}

function getActiveChat() { return state.activeChatId ? state.chats[state.activeChatId] : null; }

function scrollToBottom() { els.chatArea.scrollTop = els.chatArea.scrollHeight; }

function resizeInput() {
  const el = els.chatInput;
  el.style.height = 'auto';
  el.style.height = Math.min(Math.max(el.scrollHeight, 46), 73) + 'px';
}

// ── View switching ─────────────────────────────
function switchView(view) {
  currentView = view;
  if (view === 'agents') {
    els.chatArea.style.display   = 'none';
    els.inputArea.style.display  = 'none';
    els.agentsView.style.display = 'flex';
    els.chatTopbarActions.style.display   = 'none';
    els.agentsTopbarActions.style.display = 'flex';
    renderAgentsView();
  } else {
    els.agentsView.style.display = 'none';
    els.chatTopbarActions.style.display   = 'flex';
    els.agentsTopbarActions.style.display = 'none';
    els.chatArea.style.display  = '';
    els.inputArea.style.display = '';
    updateLayout();
  }
}

// ── Agents view rendering ──────────────────────
function renderAgentsView() {
  const agents = loadAgents();
  if (selectedAgentId) {
    els.agentsListScreen.style.display = 'none';
    els.agentDetail.style.display      = 'flex';
    renderAgentDetail(selectedAgentId);
  } else {
    els.agentsListScreen.style.display = 'flex';
    els.agentDetail.style.display      = 'none';
    renderAgentsList(agents);
  }
}

function renderAgentsList(agents) {
  if (!agents.length) {
    els.agentsEmpty.style.display = 'flex';
    els.agentsGrid.innerHTML = '';
  } else {
    els.agentsEmpty.style.display = 'none';
    els.agentsGrid.innerHTML = agents.map(a => `
      <div class="agent-card" data-agent-id="${escHtml(a.id)}">
        <div class="agent-card-avatar">${escHtml((a.title[0] || 'A').toUpperCase())}</div>
        <div>
          <div class="agent-card-title">${escHtml(a.title)}</div>
          <div class="agent-card-username">@${escHtml(a.username)}</div>
        </div>
        ${a.description ? `<div class="agent-card-desc">${escHtml(a.description)}</div>` : ''}
        <span class="agent-card-type">${escHtml(a.type)}</span>
      </div>
    `).join('');
  }
}

function renderAgentDetail(agentId) {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === agentId);
  if (!agent) { selectedAgentId = null; renderAgentsView(); return; }

  els.agentDetailNav.innerHTML = `
    <button class="agent-detail-back" id="agentDetailBack">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      Back
    </button>
    <div class="agent-detail-agent-name">${escHtml(agent.title)}</div>
    ${AGENT_NAV.map(item => `
      <button class="agent-detail-nav-item ${item.id === selectedAgentSection ? 'active' : ''}" data-section="${item.id}">
        ${item.label}
      </button>
    `).join('')}
  `;

  renderAgentSection(agent, selectedAgentSection);

  document.getElementById('agentDetailBack')?.addEventListener('click', () => {
    selectedAgentId = null;
    renderAgentsView();
  });

  els.agentDetailNav.querySelectorAll('[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedAgentSection = btn.dataset.section;
      renderAgentDetail(agentId);
    });
  });
}

function renderAgentSection(agent, section) {
  if (section === 'general') {
    els.agentDetailContent.innerHTML = `
      <h2 class="agent-detail-section-title">General</h2>
      <div class="agent-detail-field"><label>Title</label><p>${escHtml(agent.title)}</p></div>
      <div class="agent-detail-field"><label>Username</label><p>@${escHtml(agent.username)}</p></div>
      ${agent.description ? `<div class="agent-detail-field"><label>Description</label><p>${escHtml(agent.description)}</p></div>` : ''}
      <div class="agent-detail-field"><label>Type</label><p>${escHtml(agent.type)}</p></div>
      <div class="agent-detail-field"><label>Created</label><p>${new Date(agent.createdAt).toLocaleDateString([],{year:'numeric',month:'long',day:'numeric'})}</p></div>
    `;
  } else {
    const label = AGENT_NAV.find(n => n.id === section)?.label || section;
    els.agentDetailContent.innerHTML = `
      <h2 class="agent-detail-section-title">${label}</h2>
      <div class="agent-detail-coming">Coming soon</div>
    `;
  }
}

// ── Add agent modal ────────────────────────────
function openAddAgentModal() {
  els.newAgentTitle.value       = '';
  els.newAgentUsername.value    = '';
  els.newAgentDescription.value = '';
  els.newAgentApi.value         = '';
  els.newAgentType.value        = 'Assistant';
  els.addAgentModal.classList.add('open');
  els.newAgentTitle.focus();
}

function closeAddAgentModal() { els.addAgentModal.classList.remove('open'); }

function handleCreateAgent() {
  const title    = els.newAgentTitle.value.trim();
  const username = els.newAgentUsername.value.trim();
  if (!title)    { toast('Title is required', 'error'); return; }
  if (!username) { toast('Username is required', 'error'); return; }
  createNewAgent({
    title, username,
    description: els.newAgentDescription.value.trim(),
    api:         els.newAgentApi.value.trim(),
    type:        els.newAgentType.value,
  });
  closeAddAgentModal();
  renderAgentsView();
  toast('Agent created!', 'success');
}

// ── Layout helpers ─────────────────────────────
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
  resizeInput();
}

// ── History ────────────────────────────────────
function renderHistory() {
  const pinned = getPinnedIds();
  const pinnedSet = new Set(pinned);
  const all = Object.keys(state.chats);
  if (!all.length) { els.historyList.innerHTML = '<div class="history-empty">No chats yet.</div>'; return; }

  const sorted = [
    ...pinned.filter(id => state.chats[id]),
    ...all.filter(id => !pinnedSet.has(id)).sort((a,b) => state.chats[b].createdAt - state.chats[a].createdAt),
  ];

  const pinSvg = `<svg class="pin-icon" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M16 4v6l2 2-6 6-2-6H4l2-2 6-2V4h4z"/></svg>`;

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

function hideCtxMenu() { els.ctxMenu.classList.remove('open'); ctxTargetId = null; }

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
  const isUser   = msg.role === 'user';
  const agentKey = (msg.agent && agentPersonas[msg.agent]) ? msg.agent : 'chatbot';
  const label    = isUser ? 'You' : agentPersonas[agentKey].name;
  const content  = isUser ? `<p>${escHtml(msg.content)}</p>` : renderMarkdown(msg.content);
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
  setPinnedIds(getPinnedIds().filter(p => p !== id));
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

// ── Loading state ──────────────────────────────
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
    try { state.activeChatId = await dbCreateChat(state.agent); renderHistory(); }
    catch (err) { toast('Could not create chat: ' + err.message, 'error'); return; }
  }

  const chat = getActiveChat();
  els.chatInput.value = '';
  els.chatInput.style.height = 'auto';
  resizeInput();

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
    const errMsg = { id: `err_${Date.now()}`, role: 'assistant', agent: state.agent,
      content: `**Error:** ${err.message || 'Something went wrong. Check your API key.'}` };
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
  const persona  = agentPersonas[agentKey];
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
  els.connDot.className     = 'conn-dot' + (connected ? ' active' : '');
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
  const meta   = user.user_metadata || {};
  const name   = meta.full_name || meta.name || user.email?.split('@')[0] || 'User';
  const avatar = meta.avatar_url || meta.picture || '';
  els.userName.textContent         = name;
  els.userEmailDisplay.textContent = user.email || '';
  if (avatar) { els.userAvatarImg.src = avatar; els.userAvatarImg.style.display = 'block'; }
  else { els.userAvatarImg.style.display = 'none'; }
}

async function onLogin(user) {
  state.user = user;
  loadSettings();
  updateUserDisplay(user);

  try {
    try { await dbLoadChats(); } catch (err) { toast('Failed to load chats: ' + err.message, 'error'); }
    const ids = Object.keys(state.chats);
    if (ids.length) {
      state.activeChatId = ids[0];
      try { await dbLoadMessages(state.activeChatId); } catch (_) {}
    }
  } finally {
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
}

function onSignOut() {
  state.user = null; state.chats = {}; state.activeChatId = null;
  currentView = 'chat'; selectedAgentId = null;
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
    if (currentView !== 'chat') {
      document.querySelectorAll('.agent-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.agent-tab[data-agent="chatbot"]')?.classList.add('active');
      switchView('chat');
    } else {
      renderHistory();
      renderMessages();
      updateLayout();
    }
  });

  els.projectsBtn.addEventListener('click', () => toast('Projects — coming soon', ''));
  els.moreBtn.addEventListener('click',     () => toast('More — coming soon', ''));

  // Agent tabs → switch views
  document.querySelectorAll('.agent-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const type = tab.dataset.agent;
      if (type === 'automation') { toast('Automation — coming soon', ''); return; }
      document.querySelectorAll('.agent-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (type === 'agent') {
        switchView('agents');
      } else {
        state.agent = type;
        if (currentView !== 'chat') {
          selectedAgentId = null;
          switchView('chat');
        }
      }
    });
  });

  // History clicks
  els.historyList.addEventListener('click', e => {
    if (e.target.closest('.rename-input')) return;
    const item = e.target.closest('[data-id]');
    if (item) {
      if (currentView !== 'chat') {
        document.querySelectorAll('.agent-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.agent-tab[data-agent="chatbot"]')?.classList.add('active');
        switchView('chat');
      }
      switchChat(item.dataset.id);
    }
  });

  // Right-click context menu on history items
  els.historyList.addEventListener('contextmenu', e => {
    const item = e.target.closest('[data-id]');
    if (item) showCtxMenu(e, item.dataset.id);
  });

  els.ctxPin.addEventListener('click',    () => { if (ctxTargetId) { togglePin(ctxTargetId); renderHistory(); } hideCtxMenu(); });
  els.ctxRename.addEventListener('click', () => { const id = ctxTargetId; hideCtxMenu(); if (id) startRename(id); });
  els.ctxDelete.addEventListener('click', () => { const id = ctxTargetId; hideCtxMenu(); if (id) deleteChat(id); });
  document.addEventListener('click',   e => { if (!els.ctxMenu.contains(e.target)) hideCtxMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideCtxMenu(); closeAddAgentModal(); closeSettingsModal(); } });

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
      chat.messages = []; chat.messagesLoaded = true;
      renderMessages(); updateLayout(); toast('Chat cleared');
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

  // Agents
  els.addAgentBtn.addEventListener('click', openAddAgentModal);
  els.closeAddAgent.addEventListener('click', closeAddAgentModal);
  els.cancelAddAgent.addEventListener('click', closeAddAgentModal);
  els.addAgentModal.addEventListener('click', e => { if (e.target === els.addAgentModal) closeAddAgentModal(); });
  els.createAgentBtn.addEventListener('click', handleCreateAgent);

  els.agentsGrid.addEventListener('click', e => {
    const card = e.target.closest('[data-agent-id]');
    if (card) { selectedAgentId = card.dataset.agentId; selectedAgentSection = 'general'; renderAgentsView(); }
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

function showLogin() {
  els.loadingScreen.style.display = 'none';
  els.loginScreen.style.display   = 'flex';
}

async function tryLogin(user) {
  try { await onLogin(user); }
  catch (err) { console.error('onLogin failed:', err); appInitialized = false; showLogin(); }
}

async function init() {
  initEvents();

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user && !appInitialized) {
      appInitialized = true;
      tryLogin(session.user);
    } else if (event === 'SIGNED_OUT') {
      appInitialized = false;
      onSignOut();
    }
  });

  let bootSession = null;
  try {
    bootSession = await Promise.race([
      db.auth.getSession().then(r => r?.data?.session ?? null),
      new Promise(resolve => setTimeout(() => resolve(null), 5000)),
    ]);
  } catch (_) { bootSession = null; }

  if (!appInitialized) {
    if (bootSession?.user) {
      appInitialized = true;
      await tryLogin(bootSession.user);
    } else {
      showLogin();
    }
  }
}

init();
