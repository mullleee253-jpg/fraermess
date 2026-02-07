// API Base URL
const API_BASE = window.location.origin + '/api';

// State
const state = {
    user: null,
    token: localStorage.getItem('token'),
    view: 'login',
    servers: [],
    friends: [],
    friendRequests: [],
    dms: [],
    activeServer: null,
    activeChannel: null,
    activeDM: null,
    messages: {},
    members: {},
    socket: null
};

// Socket connection
let socket = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (state.token) {
        loadUser();
    } else {
        render();
    }
});

// API Functions
async function apiCall(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(state.token && { 'Authorization': `Bearer ${state.token}` })
        },
        ...options
    };

    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    const response = await fetch(url, config);
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Request failed');
    }

    return response.json();
}

// Auth Functions
async function register(username, email, password) {
    try {
        const data = await apiCall('/register', {
            method: 'POST',
            body: { username, email, password }
        });

        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('token', data.token);
        
        await loadUserData();
        connectSocket();
        state.view = 'home';
        render();
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function login(email, password) {
    try {
        const data = await apiCall('/login', {
            method: 'POST',
            body: { email, password }
        });

        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('token', data.token);
        
        await loadUserData();
        connectSocket();
        state.view = 'home';
        render();
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function loadUser() {
    try {
        const user = await apiCall('/me');
        state.user = user;
        await loadUserData();
        connectSocket();
        state.view = 'home';
        render();
    } catch (error) {
        logout();
    }
}

async function loadUserData() {
    try {
        // Load servers
        state.servers = await apiCall('/servers');
        
        // Load friends
        const userData = await apiCall('/me');
        state.friends = userData.friends || [];
        
        // Load friend requests
        state.friendRequests = await apiCall('/friends/requests');
        
        // Load DMs
        state.dms = await apiCall('/dms');
        
        // Set active server/channel
        if (state.servers.length > 0 && !state.activeServer) {
            state.activeServer = state.servers[0]._id;
            if (state.servers[0].channels.length > 0) {
                state.activeChannel = state.servers[0].channels[0]._id;
            }
        }
    } catch (error) {
        console.error('Failed to load user data:', error);
    }
}

function logout() {
    state.token = null;
    state.user = null;
    state.view = 'login';
    localStorage.removeItem('token');
    
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    
    render();
}

// Socket Functions
function connectSocket() {
    if (socket) return;
    
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('join', {
            userId: state.user.id,
            servers: state.servers.map(s => s._id)
        });
    });
    
    socket.on('message', (data) => {
        const { serverId, channelId, message } = data;
        const key = `${serverId}-${channelId}`;
        
        if (!state.messages[key]) {
            state.messages[key] = [];
        }
        
        state.messages[key].push(message);
        
        if (state.activeServer === serverId && state.activeChannel === channelId) {
            render();
            scrollToBottom();
        }
    });
    
    socket.on('dm-message', (data) => {
        const { dmId, message } = data;
        
        if (!state.messages[`dm-${dmId}`]) {
            state.messages[`dm-${dmId}`] = [];
        }
        
        state.messages[`dm-${dmId}`].push(message);
        
        if (state.activeDM === dmId) {
            render();
            scrollToBottom();
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
}

// UI Functions
function render() {
    const app = document.getElementById('app');
    
    if (state.view === 'login') {
        app.innerHTML = renderLogin();
    } else if (state.view === 'register') {
        app.innerHTML = renderRegister();
    } else if (state.view === 'friends') {
        app.innerHTML = renderFriends();
    } else if (state.view === 'dm') {
        app.innerHTML = renderDM();
    } else {
        app.innerHTML = renderMain();
    }
}

function renderLogin() {
    return `
        <div class="auth-screen">
            <div class="auth-box">
                <h1>Welcome back!</h1>
                <p>We're so excited to see you again!</p>
                
                <div id="auth-error"></div>
                
                <form onsubmit="handleLogin(event)">
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" class="form-input" id="loginEmail" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input type="password" class="form-input" id="loginPassword" required>
                    </div>
                    <button type="submit" class="btn" id="loginBtn">Log In</button>
                </form>
                <div class="auth-switch">
                    Need an account? <a onclick="switchToRegister()">Register</a>
                </div>
            </div>
        </div>
    `;
}

function renderRegister() {
    return `
        <div class="auth-screen">
            <div class="auth-box">
                <h1>Create an account</h1>
                <p>Join millions of users</p>
                
                <div id="auth-error"></div>
                
                <form onsubmit="handleRegister(event)">
                    <div class="form-group">
                        <label class="form-label">Username</label>
                        <input type="text" class="form-input" id="regUsername" required minlength="3" maxlength="20">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" class="form-input" id="regEmail" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input type="password" class="form-input" id="regPassword" required minlength="6">
                    </div>
                    <button type="submit" class="btn" id="registerBtn">Continue</button>
                </form>
                <div class="auth-switch">
                    <a onclick="switchToLogin()">Already have an account?</a>
                </div>
            </div>
        </div>
    `;
}

function renderMain() {
    return `
        <div class="app">
            ${renderServers()}
            ${renderSidebar()}
            ${renderChat()}
            ${renderMembers()}
        </div>
    `;
}

function renderFriends() {
    return `
        <div class="app">
            ${renderServers()}
            ${renderFriendsSidebar()}
            ${renderFriendsChat()}
        </div>
    `;
}

function renderDM() {
    return `
        <div class="app">
            ${renderServers()}
            ${renderFriendsSidebar()}
            ${renderDMChat()}
        </div>
    `;
}

function renderServers() {
    return `
        <div class="servers">
            <div class="server home ${state.view === 'friends' ? 'active' : ''}" onclick="switchToFriends()">
                👥
            </div>
            <div class="divider"></div>
            ${state.servers.map(s => `
                <div class="server ${state.activeServer === s._id ? 'active' : ''}" 
                     onclick="switchServer('${s._id}')"
                     title="${s.name}">
                    ${s.icon}
                </div>
            `).join('')}
            <div class="server add" onclick="openCreateServerModal()">+</div>
        </div>
    `;
}

function renderSidebar() {
    const server = state.servers.find(s => s._id === state.activeServer);
    if (!server) return '';
    
    return `
        <div class="sidebar">
            <div class="sidebar-header">
                <span>${server.name}</span>
                <span>▼</span>
            </div>
            <div class="sidebar-content">
                <div class="category">
                    <span>Text Channels</span>
                    <button onclick="openCreateChannelModal('text')">+</button>
                </div>
                ${server.channels.filter(c => c.type === 'text').map(c => `
                    <div class="channel ${state.activeChannel === c._id ? 'active' : ''}" 
                         onclick="switchChannel('${c._id}')">
                        <span>#</span>
                        <span>${c.name}</span>
                    </div>
                `).join('')}
                
                <div class="category">
                    <span>Voice Channels</span>
                    <button onclick="openCreateChannelModal('voice')">+</button>
                </div>
                ${server.channels.filter(c => c.type === 'voice').map(c => `
                    <div class="channel ${state.activeChannel === c._id ? 'active' : ''}" 
                         onclick="switchChannel('${c._id}')">
                        <span>🔊</span>
                        <span>${c.name}</span>
                    </div>
                `).join('')}
            </div>
            ${renderUserPanel()}
        </div>
    `;
}

function renderFriendsSidebar() {
    return `
        <div class="sidebar">
            <div class="sidebar-header">
                <span>Friends</span>
            </div>
            <div class="sidebar-content">
                <div class="category">
                    <span>Direct Messages</span>
                    <button onclick="openAddFriendModal()">+</button>
                </div>
                ${state.dms.map(dm => {
                    const friend = dm.participants.find(p => p._id !== state.user.id);
                    return `
                        <div class="dm-item ${state.activeDM === dm._id ? 'active' : ''}" 
                             onclick="openDM('${dm._id}')">
                            <div class="avatar">
                                ${friend.avatar}
                                <div class="status ${friend.status}"></div>
                            </div>
                            <span>${friend.username}</span>
                        </div>
                    `;
                }).join('')}
            </div>
            ${renderUserPanel()}
        </div>
    `;
}

function renderUserPanel() {
    return `
        <div class="user-panel">
            <div class="user-info">
                <div class="avatar">
                    ${state.user.avatar}
                    <div class="status online"></div>
                </div>
                <div>
                    <div style="font-weight: 600; font-size: 14px;">${state.user.username}</div>
                    <div style="font-size: 12px; color: #3ba55d;">Online</div>
                </div>
            </div>
            <div class="user-controls">
                <button title="Mute">🎤</button>
                <button title="Deafen">🎧</button>
                <button onclick="openSettingsModal()" title="Settings">⚙️</button>
                <button onclick="logout()" title="Logout">🚪</button>
            </div>
        </div>
    `;
}

function renderChat() {
    const server = state.servers.find(s => s._id === state.activeServer);
    const channel = server?.channels.find(c => c._id === state.activeChannel);
    
    if (!channel) {
        return `
            <div class="chat">
                <div class="welcome">
                    <h2>Select a channel</h2>
                    <p>Choose a channel to start chatting</p>
                </div>
            </div>
        `;
    }
    
    const messageKey = `${state.activeServer}-${state.activeChannel}`;
    const messages = state.messages[messageKey] || [];
    
    return `
        <div class="chat">
            <div class="chat-header">
                <span style="font-size: 24px; color: #949ba4;">${channel.type === 'voice' ? '🔊' : '#'}</span>
                <span style="font-weight: 600; font-size: 16px;">${channel.name}</span>
            </div>
            <div class="messages" id="messages">
                ${messages.length === 0 ? `
                    <div class="welcome">
                        <h2>Welcome to #${channel.name}!</h2>
                        <p>This is the start of the #${channel.name} channel.</p>
                    </div>
                ` : messages.map(m => `
                    <div class="message">
                        <div class="msg-avatar">${m.author.avatar}</div>
                        <div class="msg-content">
                            <div class="msg-header">
                                <span class="msg-author">${m.author.username}</span>
                                <span class="msg-time">${new Date(m.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div class="msg-text">${m.content}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            ${channel.type === 'text' ? `
                <div class="input-wrapper">
                    <input type="text" placeholder="Message #${channel.name}" 
                           onkeypress="handleMessageInput(event)" id="messageInput">
                </div>
            ` : `
                <div style="padding: 20px; text-align: center; background: rgba(0,0,0,0.3);">
                    <h3 style="color: #3ba55d; margin-bottom: 8px;">Voice Channel</h3>
                    <p style="color: #949ba4; margin-bottom: 16px;">Connect to start talking</p>
                    <button class="btn" style="width: auto; padding: 10px 20px;">Connect</button>
                </div>
            `}
        </div>
    `;
}

function renderFriendsChat() {
    return `
        <div class="chat">
            <div class="friends-header">
                <button class="friends-tab active">All</button>
                <button class="friends-tab" onclick="showFriendRequests()">
                    Pending ${state.friendRequests.length > 0 ? state.friendRequests.length : ''}
                </button>
                <button class="friends-tab" onclick="openAddFriendModal()">Add Friend</button>
            </div>
            <div class="messages">
                ${state.friends.length === 0 ? `
                    <div class="welcome">
                        <h2>No friends yet</h2>
                        <p>Add friends to start chatting!</p>
                    </div>
                ` : state.friends.map(f => `
                    <div class="friend-request">
                        <div class="friend-request-info">
                            <div class="avatar">
                                ${f.avatar}
                                <div class="status ${f.status}"></div>
                            </div>
                            <div>
                                <div style="font-weight: 600;">${f.username}</div>
                                <div style="font-size: 14px; color: #949ba4;">${f.status}</div>
                            </div>
                        </div>
                        <div class="friend-request-actions">
                            <button class="btn" onclick="createDM('${f._id}')">Message</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderDMChat() {
    const dm = state.dms.find(d => d._id === state.activeDM);
    if (!dm) return '';
    
    const friend = dm.participants.find(p => p._id !== state.user.id);
    const messages = state.messages[`dm-${dm._id}`] || [];
    
    return `
        <div class="chat">
            <div class="chat-header">
                <div class="avatar">
                    ${friend.avatar}
                    <div class="status ${friend.status}"></div>
                </div>
                <span style="font-weight: 600; font-size: 16px;">${friend.username}</span>
            </div>
            <div class="messages" id="messages">
                ${messages.length === 0 ? `
                    <div class="welcome">
                        <h2>Start of conversation</h2>
                        <p>This is the beginning of your direct message history with ${friend.username}.</p>
                    </div>
                ` : messages.map(m => `
                    <div class="message">
                        <div class="msg-avatar">${m.author.avatar}</div>
                        <div class="msg-content">
                            <div class="msg-header">
                                <span class="msg-author">${m.author.username}</span>
                                <span class="msg-time">${new Date(m.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div class="msg-text">${m.content}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="input-wrapper">
                <input type="text" placeholder="Message @${friend.username}" 
                       onkeypress="handleDMInput(event)" id="dmInput">
            </div>
        </div>
    `;
}

function renderMembers() {
    const server = state.servers.find(s => s._id === state.activeServer);
    if (!server || !server.members) return '';
    
    return `
        <div class="members">
            <div class="members-title">Members — ${server.members.length}</div>
            ${server.members.map(m => `
                <div class="member">
                    <div class="avatar">
                        ${m.avatar || '👤'}
                        <div class="status ${m.status || 'offline'}"></div>
                    </div>
                    <span>${m.username}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// Event Handlers
async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    
    btn.disabled = true;
    btn.textContent = 'Logging in...';
    
    const result = await login(email, password);
    
    if (!result.success) {
        showError(result.error);
        btn.disabled = false;
        btn.textContent = 'Log In';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const btn = document.getElementById('registerBtn');
    
    btn.disabled = true;
    btn.textContent = 'Creating account...';
    
    const result = await register(username, email, password);
    
    if (!result.success) {
        showError(result.error);
        btn.disabled = false;
        btn.textContent = 'Continue';
    }
}

function handleMessageInput(e) {
    if (e.key === 'Enter') {
        const content = e.target.value.trim();
        if (content && socket) {
            socket.emit('message', {
                serverId: state.activeServer,
                channelId: state.activeChannel,
                content
            });
            e.target.value = '';
        }
    }
}

function handleDMInput(e) {
    if (e.key === 'Enter') {
        const content = e.target.value.trim();
        if (content && socket) {
            socket.emit('dm-message', {
                dmId: state.activeDM,
                content
            });
            e.target.value = '';
        }
    }
}

// Navigation
function switchToLogin() {
    state.view = 'login';
    render();
}

function switchToRegister() {
    state.view = 'register';
    render();
}

function switchToFriends() {
    state.view = 'friends';
    state.activeServer = null;
    state.activeChannel = null;
    state.activeDM = null;
    render();
}

function switchServer(serverId) {
    state.activeServer = serverId;
    state.view = 'home';
    state.activeDM = null;
    
    const server = state.servers.find(s => s._id === serverId);
    if (server && server.channels.length > 0) {
        state.activeChannel = server.channels[0]._id;
        loadMessages();
    }
    
    render();
}

function switchChannel(channelId) {
    state.activeChannel = channelId;
    loadMessages();
    render();
}

function openDM(dmId) {
    state.activeDM = dmId;
    state.view = 'dm';
    state.activeServer = null;
    state.activeChannel = null;
    loadDMMessages();
    render();
}

// Data Loading
async function loadMessages() {
    if (!state.activeServer || !state.activeChannel) return;
    
    try {
        const messageKey = `${state.activeServer}-${state.activeChannel}`;
        if (!state.messages[messageKey]) {
            const messages = await apiCall(`/servers/${state.activeServer}/channels/${state.activeChannel}/messages`);
            state.messages[messageKey] = messages;
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

async function loadDMMessages() {
    if (!state.activeDM) return;
    
    try {
        const messageKey = `dm-${state.activeDM}`;
        if (!state.messages[messageKey]) {
            const dm = state.dms.find(d => d._id === state.activeDM);
            if (dm && dm.messages) {
                state.messages[messageKey] = dm.messages;
            }
        }
    } catch (error) {
        console.error('Failed to load DM messages:', error);
    }
}

// Modals
function openCreateServerModal() {
    showModal('Create Server', `
        <div class="form-group">
            <label class="form-label">Server Name</label>
            <input type="text" class="form-input" id="serverName" placeholder="My Awesome Server">
        </div>
        <div class="form-group">
            <label class="form-label">Server Icon (emoji)</label>
            <input type="text" class="form-input" id="serverIcon" placeholder="🏠" maxlength="2">
        </div>
    `, async () => {
        const name = document.getElementById('serverName').value.trim();
        const icon = document.getElementById('serverIcon').value.trim() || '🏠';
        
        if (name) {
            try {
                const server = await apiCall('/servers', {
                    method: 'POST',
                    body: { name, icon }
                });
                
                state.servers.push(server);
                closeModal();
                render();
            } catch (error) {
                showError(error.message);
            }
        }
    });
}

function openCreateChannelModal(type) {
    showModal(`Create ${type === 'voice' ? 'Voice' : 'Text'} Channel`, `
        <div class="form-group">
            <label class="form-label">Channel Name</label>
            <input type="text" class="form-input" id="channelName" placeholder="${type === 'voice' ? 'General Voice' : 'general'}">
        </div>
    `, async () => {
        const name = document.getElementById('channelName').value.trim();
        
        if (name) {
            try {
                await apiCall(`/servers/${state.activeServer}/channels`, {
                    method: 'POST',
                    body: { name, type }
                });
                
                // Reload server data
                const server = await apiCall(`/servers/${state.activeServer}`);
                const serverIndex = state.servers.findIndex(s => s._id === state.activeServer);
                state.servers[serverIndex] = server;
                
                closeModal();
                render();
            } catch (error) {
                showError(error.message);
            }
        }
    });
}

function openAddFriendModal() {
    showModal('Add Friend', `
        <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" class="form-input" id="friendUsername" placeholder="Enter username">
        </div>
    `, async () => {
        const username = document.getElementById('friendUsername').value.trim();
        
        if (username) {
            try {
                await apiCall('/friends/request', {
                    method: 'POST',
                    body: { username }
                });
                
                showSuccess('Friend request sent!');
                closeModal();
            } catch (error) {
                showError(error.message);
            }
        }
    });
}

async function createDM(friendId) {
    try {
        const dm = await apiCall('/dms', {
            method: 'POST',
            body: { userId: friendId }
        });
        
        // Add to DMs if not already there
        if (!state.dms.find(d => d._id === dm._id)) {
            state.dms.push(dm);
        }
        
        openDM(dm._id);
    } catch (error) {
        showError(error.message);
    }
}

function showModal(title, content, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    
    // Определяем нужна ли кнопка подтверждения
    const needsConfirmButton = title !== 'Friend Requests';
    const buttonText = title === 'User Settings' ? 'Save' : 'Create';
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">${title}</div>
            <div id="modal-error"></div>
            ${content}
            <div class="modal-buttons">
                <button class="btn btn-secondary" onclick="closeModal()">Close</button>
                ${needsConfirmButton ? `<button class="btn" id="modalConfirm">${buttonText}</button>` : ''}
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    if (needsConfirmButton && onConfirm) {
        document.getElementById('modalConfirm').onclick = onConfirm;
    }
    
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

function closeModal() {
    const modal = document.querySelector('.modal');
    if (modal) modal.remove();
}

function showError(message) {
    const errorDiv = document.getElementById('auth-error') || document.getElementById('modal-error');
    if (errorDiv) {
        errorDiv.innerHTML = `<div class="error">${message}</div>`;
    }
}

function showSuccess(message) {
    const errorDiv = document.getElementById('auth-error') || document.getElementById('modal-error');
    if (errorDiv) {
        errorDiv.innerHTML = `<div class="success">${message}</div>`;
    }
}

function scrollToBottom() {
    setTimeout(() => {
        const messages = document.getElementById('messages');
        if (messages) {
            messages.scrollTop = messages.scrollHeight;
        }
    }, 100);
}

async function acceptFriendRequest(requestId) {
    try {
        await apiCall('/friends/accept', {
            method: 'POST',
            body: { requestId }
        });
        
        await loadUserData();
        render();
    } catch (error) {
        showError(error.message);
    }
}

function showFriendRequests() {
    if (state.friendRequests.length === 0) {
        showModal('Friend Requests', '<p style="text-align: center; color: #949ba4;">No pending friend requests</p>', () => closeModal());
        return;
    }
    
    const requestsHtml = state.friendRequests.map(req => `
        <div class="friend-request">
            <div class="friend-request-info">
                <div class="avatar">${req.from.avatar}</div>
                <div>
                    <div style="font-weight: 600;">${req.from.username}</div>
                    <div style="font-size: 14px; color: #949ba4;">Incoming Friend Request</div>
                </div>
            </div>
            <div class="friend-request-actions">
                <button class="btn-accept" onclick="acceptFriendRequest('${req._id}')">Accept</button>
                <button class="btn-decline">Decline</button>
            </div>
        </div>
    `).join('');
    
    showModal('Friend Requests', requestsHtml, () => closeModal());
}

function openSettingsModal() {
    showModal('User Settings', `
        <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" class="form-input" id="settingsUsername" value="${state.user.username}">
        </div>
        <div class="form-group">
            <label class="form-label">Avatar (emoji)</label>
            <input type="text" class="form-input" id="settingsAvatar" value="${state.user.avatar}" maxlength="2">
        </div>
        <div class="form-group">
            <label class="form-label">Status</label>
            <select class="form-input" id="settingsStatus">
                <option value="online" ${state.user.status === 'online' ? 'selected' : ''}>Online</option>
                <option value="idle" ${state.user.status === 'idle' ? 'selected' : ''}>Idle</option>
                <option value="dnd" ${state.user.status === 'dnd' ? 'selected' : ''}>Do Not Disturb</option>
                <option value="offline" ${state.user.status === 'offline' ? 'selected' : ''}>Invisible</option>
            </select>
        </div>
    `, async () => {
        const username = document.getElementById('settingsUsername').value.trim();
        const avatar = document.getElementById('settingsAvatar').value.trim();
        const status = document.getElementById('settingsStatus').value;
        
        if (username) {
            try {
                const updatedUser = await apiCall('/me', {
                    method: 'PUT',
                    body: { username, avatar, status }
                });
                
                state.user = { ...state.user, username, avatar, status };
                showSuccess('Settings updated!');
                setTimeout(() => {
                    closeModal();
                    render();
                }, 1000);
            } catch (error) {
                showError(error.message);
            }
        }
    });
}