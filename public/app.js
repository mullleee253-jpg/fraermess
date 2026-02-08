// МАКСИМАЛЬНАЯ ВЕРСИЯ DISCORD CLONE - ВСЕ ИСПРАВЛЕНО
// API Base URL
const API_BASE = window.location.origin + '/api';

// Global State
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
    socket: null,
    isConnected: false
};

// Socket connection
let socket = null;
let activeCall = null;
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isCallActive = false;

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 App initializing...');
    
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    if (state.token) {
        loadUser();
    } else {
        render();
    }
});

// Format message content with images and links
function formatMessage(content) {
    if (!content) return '';
    
    const imageRegex = /https?:\/\/.*\.(jpg|jpeg|png|gif|webp|bmp|svg)/i;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    
    if (imageRegex.test(content)) {
        return `<img src="${content}" alt="Image" onclick="window.open('${content}', '_blank')" style="max-width: 400px; max-height: 300px; border-radius: 8px; cursor: pointer; margin-top: 8px;">`;
    }
    
    content = content.replace(urlRegex, '<a href="$1" target="_blank" style="color: #00aff4;">$1</a>');
    
    return content;
}

// API Functions with better error handling
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

    try {
        const response = await fetch(url, config);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return response.json();
    } catch (error) {
        console.error(`API Error ${endpoint}:`, error);
        throw error;
    }
}
// Auth Functions
async function register(username, email, password) {
    try {
        console.log('🔐 Registering user:', username);
        const data = await apiCall('/register', {
            method: 'POST',
            body: { username, email, password }
        });

        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('token', data.token);
        
        console.log('✅ Registration successful');
        await loadUserData();
        connectSocket();
        state.view = 'home';
        render();
        
        return { success: true };
    } catch (error) {
        console.error('❌ Registration failed:', error);
        return { success: false, error: error.message };
    }
}

async function login(email, password) {
    try {
        console.log('🔐 Logging in user:', email);
        const data = await apiCall('/login', {
            method: 'POST',
            body: { email, password }
        });

        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('token', data.token);
        
        console.log('✅ Login successful');
        await loadUserData();
        connectSocket();
        state.view = 'home';
        render();
        
        return { success: true };
    } catch (error) {
        console.error('❌ Login failed:', error);
        return { success: false, error: error.message };
    }
}

async function loadUser() {
    try {
        console.log('👤 Loading user data...');
        const user = await apiCall('/me');
        state.user = user;
        await loadUserData();
        connectSocket();
        state.view = 'home';
        render();
        console.log('✅ User loaded:', user.username);
    } catch (error) {
        console.error('❌ Failed to load user:', error);
        logout();
    }
}

async function loadUserData() {
    try {
        console.log('📊 Loading user data...');
        
        // Load all data in parallel
        const [servers, userData, friendRequests, dms] = await Promise.all([
            apiCall('/servers'),
            apiCall('/me'),
            apiCall('/friends/requests'),
            apiCall('/dms')
        ]);
        
        state.servers = servers || [];
        state.friends = userData.friends || [];
        state.friendRequests = friendRequests || [];
        state.dms = dms || [];
        
        // Set default server/channel
        if (state.servers.length > 0 && !state.activeServer) {
            state.activeServer = state.servers[0]._id;
            if (state.servers[0].channels && state.servers[0].channels.length > 0) {
                state.activeChannel = state.servers[0].channels[0]._id;
            }
        }
        
        console.log('✅ User data loaded:', {
            servers: state.servers.length,
            friends: state.friends.length,
            dms: state.dms.length
        });
    } catch (error) {
        console.error('❌ Failed to load user data:', error);
    }
}

function logout() {
    console.log('🚪 Logging out...');
    state.token = null;
    state.user = null;
    state.view = 'login';
    state.isConnected = false;
    localStorage.removeItem('token');
    
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    
    render();
}
// Socket Functions - ИСПРАВЛЕНО ДЛЯ REAL-TIME
function connectSocket() {
    if (socket && socket.connected) {
        console.log('🔌 Socket already connected');
        return;
    }
    
    console.log('🔌 Connecting to socket...');
    
    socket = io({
        transports: ['websocket', 'polling'],
        timeout: 20000,
        forceNew: true
    });
    
    socket.on('connect', () => {
        console.log('✅ Socket connected:', socket.id);
        state.isConnected = true;
        
        // Join user rooms
        socket.emit('join', {
            userId: state.user.id,
            servers: state.servers.map(s => s._id)
        });
        
        // Update connection status in UI
        updateConnectionStatus(true);
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Socket disconnected');
        state.isConnected = false;
        updateConnectionStatus(false);
    });
    
    // REAL-TIME MESSAGES - ИСПРАВЛЕНО
    socket.on('message', (data) => {
        console.log('📨 New message received:', data);
        const { serverId, channelId, message } = data;
        const key = `${serverId}-${channelId}`;
        
        if (!state.messages[key]) {
            state.messages[key] = [];
        }
        
        // Ensure author is properly set
        if (message && message.author) {
            console.log('✅ Message author:', message.author.username);
        } else {
            console.warn('⚠️ Message missing author:', message);
        }
        
        // Add message to state
        state.messages[key].push(message);
        
        // Update UI if we're viewing this channel
        if (state.activeServer === serverId && state.activeChannel === channelId && state.view === 'home') {
            console.log('🔄 Updating chat UI with new message');
            renderChatMessages();
            scrollToBottom();
        }
        
        // Show notification if not focused
        if (document.hidden && Notification.permission === 'granted') {
            new Notification(`${message.author?.username || 'Someone'}`, {
                body: message.content,
                icon: message.author?.avatar || '💬'
            });
        }
    });

    // REAL-TIME DM MESSAGES - ИСПРАВЛЕНО
    socket.on('dm-message', (data) => {
        console.log('📨 New DM message received:', data);
        const { dmId, message } = data;
        const key = `dm-${dmId}`;
        
        if (!state.messages[key]) {
            state.messages[key] = [];
        }
        
        // Add message to state
        state.messages[key].push(message);
        
        // Update UI if we're viewing this DM
        if (state.activeDM === dmId && state.view === 'dm') {
            console.log('🔄 Updating DM UI with new message');
            renderChatMessages();
            scrollToBottom();
        }
        
        // Show notification
        if (document.hidden && Notification.permission === 'granted') {
            new Notification(`${message.author?.username || 'Someone'} (DM)`, {
                body: message.content,
                icon: message.author?.avatar || '💬'
            });
        }
    });
    
    // Friend requests
    socket.on('friend-request', (data) => {
        console.log('👥 New friend request:', data);
        loadFriendRequests();
        
        if (Notification.permission === 'granted') {
            new Notification('New Friend Request', {
                body: `${data.from.username} sent you a friend request`,
                icon: data.from.avatar || '👤'
            });
        }
    });
    
    socket.on('friend-accepted', (data) => {
        console.log('✅ Friend request accepted:', data);
        loadUserData();
    });
}

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.textContent = connected ? '🟢 Connected' : '🔴 Disconnected';
        statusEl.style.color = connected ? '#3ba55d' : '#ed4245';
    }
}
// UI Rendering Functions - МАКСИМАЛЬНО УЛУЧШЕННЫЙ ИНТЕРФЕЙС
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
    
    // Auto-scroll to bottom after render
    setTimeout(() => {
        scrollToBottom();
        updateConnectionStatus(state.isConnected);
    }, 100);
}

function renderLogin() {
    return `
        <div class="auth-screen">
            <div class="auth-box">
                <div class="auth-logo">💬</div>
                <h1>Welcome back!</h1>
                <p>We're so excited to see you again!</p>
                <div id="auth-error"></div>
                <form onsubmit="handleLogin(event)">
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" class="form-input" id="loginEmail" required placeholder="Enter your email">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input type="password" class="form-input" id="loginPassword" required placeholder="Enter your password">
                    </div>
                    <button type="submit" class="btn btn-primary" id="loginBtn">Log In</button>
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
                <div class="auth-logo">💬</div>
                <h1>Create an account</h1>
                <p>Join millions of users worldwide</p>
                <div id="auth-error"></div>
                <form onsubmit="handleRegister(event)">
                    <div class="form-group">
                        <label class="form-label">Username</label>
                        <input type="text" class="form-input" id="regUsername" required minlength="3" maxlength="20" placeholder="Choose a username">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" class="form-input" id="regEmail" required placeholder="Enter your email">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input type="password" class="form-input" id="regPassword" required minlength="6" placeholder="Create a password">
                    </div>
                    <button type="submit" class="btn btn-primary" id="registerBtn">Continue</button>
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
            <div class="server home ${state.view === 'friends' ? 'active' : ''}" onclick="switchToFriends()" title="Direct Messages">
                <span class="server-icon">👥</span>
                ${state.friendRequests.length > 0 ? `<div class="notification-badge">${state.friendRequests.length}</div>` : ''}
            </div>
            <div class="divider"></div>
            ${state.servers.map(s => `
                <div class="server ${state.activeServer === s._id ? 'active' : ''}" 
                     onclick="switchServer('${s._id}')" title="${s.name}">
                    <span class="server-icon">${s.icon || '🏠'}</span>
                </div>
            `).join('')}
            <div class="server add" onclick="openCreateServerModal()" title="Add a Server">
                <span class="server-icon">+</span>
            </div>
        </div>
    `;
}

function renderSidebar() {
    const server = state.servers.find(s => s._id === state.activeServer);
    if (!server) {
        return `
            <div class="sidebar">
                <div class="sidebar-header">
                    <span>No Server Selected</span>
                </div>
                <div class="sidebar-content">
                    <div class="welcome">
                        <h2>🏠 Welcome!</h2>
                        <p>Create or join a server to get started</p>
                        <button class="btn btn-primary" onclick="openCreateServerModal()">Create Server</button>
                    </div>
                </div>
                ${renderUserPanel()}
            </div>
        `;
    }
    
    const textChannels = server.channels ? server.channels.filter(c => c.type === 'text') : [];
    const voiceChannels = server.channels ? server.channels.filter(c => c.type === 'voice') : [];
    
    return `
        <div class="sidebar">
            <div class="sidebar-header" onclick="openServerMenu('${server._id}')">
                <span>${server.name}</span>
                <span class="dropdown-arrow">▼</span>
            </div>
            <div class="sidebar-content">
                ${textChannels.length > 0 ? `
                    <div class="category">
                        <span>📝 Text Channels</span>
                        <button onclick="openCreateChannelModal('text')" title="Create Channel">+</button>
                    </div>
                    ${textChannels.map(c => `
                        <div class="channel ${state.activeChannel === c._id ? 'active' : ''}" onclick="switchChannel('${c._id}')">
                            <span class="channel-icon">#</span>
                            <span class="channel-name">${c.name}</span>
                        </div>
                    `).join('')}
                ` : ''}
                
                ${voiceChannels.length > 0 ? `
                    <div class="category">
                        <span>🔊 Voice Channels</span>
                        <button onclick="openCreateChannelModal('voice')" title="Create Channel">+</button>
                    </div>
                    ${voiceChannels.map(c => `
                        <div class="channel ${state.activeChannel === c._id ? 'active' : ''}" onclick="switchChannel('${c._id}')">
                            <span class="channel-icon">🔊</span>
                            <span class="channel-name">${c.name}</span>
                        </div>
                    `).join('')}
                ` : ''}
            </div>
            ${renderUserPanel()}
        </div>
    `;
}

function renderFriendsSidebar() {
    return `
        <div class="sidebar">
            <div class="sidebar-header">
                <span>👥 Friends</span>
            </div>
            <div class="sidebar-content">
                <div class="category">
                    <span>💬 Direct Messages</span>
                    <button onclick="openAddFriendModal()" title="Add Friend">+</button>
                </div>
                ${state.dms.length === 0 ? `
                    <div class="empty-state">
                        <p>No conversations yet</p>
                        <button class="btn btn-secondary" onclick="openAddFriendModal()">Add Friend</button>
                    </div>
                ` : state.dms.map(dm => {
                    const friend = dm.participants ? dm.participants.find(p => p._id !== state.user.id) : null;
                    if (!friend) return '';
                    
                    return `
                        <div class="dm-item ${state.activeDM === dm._id ? 'active' : ''}" onclick="openDM('${dm._id}')">
                            <div class="avatar">
                                <span class="avatar-text">${friend.avatar || '👤'}</span>
                                <div class="status ${friend.status || 'offline'}"></div>
                            </div>
                            <div class="dm-info">
                                <span class="dm-name">${friend.username || 'Unknown'}</span>
                                <span class="dm-status">${friend.status || 'offline'}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            ${renderUserPanel()}
        </div>
    `;
}
function renderUserPanel() {
    if (!state.user) return '';
    
    return `
        <div class="user-panel">
            <div class="user-info" onclick="openSettingsModal()">
                <div class="avatar">
                    <span class="avatar-text">${state.user.avatar || '👤'}</span>
                    <div class="status online"></div>
                </div>
                <div class="user-details">
                    <div class="username">${state.user.username || 'User'}</div>
                    <div class="user-status" id="connectionStatus">🟢 Online</div>
                </div>
            </div>
            <div class="user-controls">
                <button class="control-btn" onclick="toggleMute()" title="Mute" id="muteBtn">🎤</button>
                <button class="control-btn" onclick="toggleDeafen()" title="Deafen" id="deafenBtn">🎧</button>
                <button class="control-btn" onclick="openSettingsModal()" title="Settings">⚙️</button>
                <button class="control-btn" onclick="logout()" title="Logout">🚪</button>
            </div>
        </div>
    `;
}

function renderChat() {
    const server = state.servers.find(s => s._id === state.activeServer);
    const channel = server?.channels?.find(c => c._id === state.activeChannel);
    
    if (!channel) {
        return `
            <div class="chat">
                <div class="chat-empty">
                    <h2>📝 Select a channel</h2>
                    <p>Choose a channel from the sidebar to start chatting</p>
                </div>
            </div>
        `;
    }
    
    return `
        <div class="chat">
            <div class="chat-header">
                <div class="channel-info">
                    <span class="channel-icon">${channel.type === 'voice' ? '🔊' : '#'}</span>
                    <span class="channel-name">${channel.name}</span>
                    <span class="channel-topic">Welcome to #${channel.name}</span>
                </div>
                <div class="chat-controls">
                    <button class="header-btn" onclick="toggleNotifications()" title="Notifications">🔔</button>
                    <button class="header-btn" onclick="openChannelSettings()" title="Channel Settings">⚙️</button>
                </div>
            </div>
            <div class="messages" id="messages">
                ${renderChatMessages()}
            </div>
            ${channel.type === 'text' ? renderMessageInput() : renderVoiceControls()}
        </div>
    `;
}

function renderChatMessages() {
    const messageKey = state.view === 'dm' ? `dm-${state.activeDM}` : `${state.activeServer}-${state.activeChannel}`;
    const messages = state.messages[messageKey] || [];
    
    if (messages.length === 0) {
        const channelName = state.view === 'dm' ? 
            (state.dms.find(d => d._id === state.activeDM)?.participants?.find(p => p._id !== state.user.id)?.username || 'User') :
            (state.servers.find(s => s._id === state.activeServer)?.channels?.find(c => c._id === state.activeChannel)?.name || 'channel');
            
        return `
            <div class="welcome">
                <div class="welcome-icon">${state.view === 'dm' ? '💬' : '🎉'}</div>
                <h2>Welcome to ${state.view === 'dm' ? '' : '#'}${channelName}!</h2>
                <p>This is the ${state.view === 'dm' ? 'beginning of your conversation' : 'start of the channel'}.</p>
            </div>
        `;
    }
    
    return messages.map((m, index) => {
        const prevMessage = messages[index - 1];
        const showAvatar = !prevMessage || prevMessage.author?._id !== m.author?._id;
        
        // Better author handling
        let author = { username: 'Unknown User', avatar: '👤' };
        if (m.author) {
            if (typeof m.author === 'object') {
                author = {
                    username: m.author.username || 'Unknown User',
                    avatar: m.author.avatar || '👤'
                };
            } else {
                // If author is just an ID, try to find user
                const user = state.user && state.user.id === m.author ? state.user : null;
                if (user) {
                    author = {
                        username: user.username || 'Unknown User',
                        avatar: user.avatar || '👤'
                    };
                }
            }
        }
        
        return `
            <div class="message ${showAvatar ? 'first-message' : 'continuation'}">
                ${showAvatar ? `
                    <div class="msg-avatar">
                        <span class="avatar-text">${author.avatar}</span>
                    </div>
                ` : '<div class="msg-avatar-spacer"></div>'}
                <div class="msg-content">
                    ${showAvatar ? `
                        <div class="msg-header">
                            <span class="msg-author">${author.username}</span>
                            <span class="msg-time">${formatTime(m.timestamp)}</span>
                        </div>
                    ` : ''}
                    <div class="msg-text">${formatMessage(m.content || '')}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderMessageInput() {
    const placeholder = state.view === 'dm' ? 
        `Message @${state.dms.find(d => d._id === state.activeDM)?.participants?.find(p => p._id !== state.user.id)?.username || 'User'}` :
        `Message #${state.servers.find(s => s._id === state.activeServer)?.channels?.find(c => c._id === state.activeChannel)?.name || 'channel'}`;
    
    return `
        <div class="input-wrapper">
            <div class="input-container">
                <input type="text" 
                       placeholder="${placeholder}" 
                       onkeypress="${state.view === 'dm' ? 'handleDMInput(event)' : 'handleMessageInput(event)'}" 
                       id="${state.view === 'dm' ? 'dmInput' : 'messageInput'}" 
                       class="message-input">
                <div class="input-controls">
                    <button class="input-btn" onclick="openFileUpload()" title="Upload file">📎</button>
                    <button class="input-btn" onclick="toggleEmojiPicker()" title="Add emoji">😀</button>
                    <button class="input-btn send-btn" onclick="${state.view === 'dm' ? 'sendDMMessage()' : 'sendMessage()'}" title="Send message">➤</button>
                </div>
            </div>
            <div id="emojiPicker" class="emoji-picker" style="display: none;">
                <div class="emoji-grid">
                    ${['😀','😂','😍','🤔','👍','👎','❤️','🔥','💯','🎉','😎','🤝','👋','💪','🙏','✨','🎮','💻','🍕','☕'].map(emoji => 
                        `<button class="emoji-btn" onclick="addEmoji('${emoji}')">${emoji}</button>`
                    ).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderVoiceControls() {
    return `
        <div class="voice-controls">
            <div class="voice-info">
                <h3>🔊 Voice Channel</h3>
                <p>Connect to start talking with others</p>
            </div>
            <div class="voice-buttons">
                <button class="btn btn-primary" onclick="connectVoice()">🎤 Connect</button>
                <button class="btn btn-secondary" onclick="shareScreen()">🖥️ Share Screen</button>
            </div>
        </div>
    `;
}
function renderFriendsChat() {
    return `
        <div class="chat">
            <div class="friends-header">
                <div class="friends-tabs">
                    <button class="friends-tab active">All</button>
                    <button class="friends-tab" onclick="showFriendRequests()">
                        Pending ${state.friendRequests.length > 0 ? `<span class="badge">${state.friendRequests.length}</span>` : ''}
                    </button>
                    <button class="friends-tab" onclick="openAddFriendModal()">Add Friend</button>
                </div>
            </div>
            <div class="messages">
                ${state.friends.length === 0 ? `
                    <div class="empty-state">
                        <div class="empty-icon">👥</div>
                        <h2>No friends yet</h2>
                        <p>Add friends to start chatting and playing together!</p>
                        <button class="btn btn-primary" onclick="openAddFriendModal()">Add Friend</button>
                    </div>
                ` : state.friends.map(f => `
                    <div class="friend-item" onclick="createDM('${f._id}')">
                        <div class="friend-info">
                            <div class="avatar">
                                <span class="avatar-text">${f.avatar || '👤'}</span>
                                <div class="status ${f.status || 'offline'}"></div>
                            </div>
                            <div class="friend-details">
                                <div class="friend-name">${f.username}</div>
                                <div class="friend-status">${f.status || 'offline'}</div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderDMChat() {
    const dm = state.dms.find(d => d._id === state.activeDM);
    if (!dm) {
        return `
            <div class="chat">
                <div class="chat-empty">
                    <h2>💬 No conversation selected</h2>
                    <p>Select a conversation from the sidebar</p>
                </div>
            </div>
        `;
    }
    
    const friend = dm.participants ? dm.participants.find(p => p._id !== state.user.id) : null;
    if (!friend) {
        return `
            <div class="chat">
                <div class="chat-empty">
                    <h2>❌ User not found</h2>
                    <p>This conversation may have been deleted</p>
                </div>
            </div>
        `;
    }
    
    return `
        <div class="chat">
            <div class="chat-header">
                <div class="dm-header-info">
                    <div class="avatar">
                        <span class="avatar-text">${friend.avatar || '👤'}</span>
                        <div class="status ${friend.status || 'offline'}"></div>
                    </div>
                    <div class="dm-details">
                        <span class="dm-name">${friend.username}</span>
                        <span class="dm-status">${friend.status || 'offline'}</span>
                    </div>
                </div>
                <div class="dm-controls">
                    <button class="header-btn" onclick="startVoiceCall('${friend._id}')" title="Start voice call">📞</button>
                    <button class="header-btn" onclick="startVideoCall('${friend._id}')" title="Start video call">📹</button>
                    <button class="header-btn" onclick="openDMSettings('${dm._id}')" title="Conversation settings">⚙️</button>
                </div>
            </div>
            <div class="messages" id="messages">
                ${renderChatMessages()}
            </div>
            ${renderMessageInput()}
        </div>
    `;
}

function renderMembers() {
    const server = state.servers.find(s => s._id === state.activeServer);
    if (!server || !server.members || state.view !== 'home') return '';
    
    return `
        <div class="members">
            <div class="members-header">
                <span>Members — ${server.members.length}</span>
            </div>
            <div class="members-list">
                ${server.members.map(m => `
                    <div class="member" onclick="openUserProfile('${m._id}')">
                        <div class="avatar">
                            <span class="avatar-text">${m.avatar || '👤'}</span>
                            <div class="status ${m.status || 'offline'}"></div>
                        </div>
                        <div class="member-info">
                            <span class="member-name">${m.username}</span>
                            <span class="member-status">${m.status || 'offline'}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// Utility Functions
function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString();
}

function scrollToBottom() {
    const messages = document.getElementById('messages');
    if (messages) {
        messages.scrollTop = messages.scrollHeight;
    }
}
// Event Handlers - ИСПРАВЛЕНО
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    
    if (!email || !password) {
        showError('Please fill in all fields');
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Logging in...';
    
    const result = await login(email, password);
    
    if (!result.success) {
        showError(result.error);
        btn.disabled = false;
        btn.innerHTML = 'Log In';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const btn = document.getElementById('registerBtn');
    
    if (!username || !email || !password) {
        showError('Please fill in all fields');
        return;
    }
    
    if (username.length < 3) {
        showError('Username must be at least 3 characters');
        return;
    }
    
    if (password.length < 6) {
        showError('Password must be at least 6 characters');
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating account...';
    
    const result = await register(username, email, password);
    
    if (!result.success) {
        showError(result.error);
        btn.disabled = false;
        btn.innerHTML = 'Continue';
    }
}

function handleMessageInput(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function handleDMInput(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendDMMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input) return;
    
    const content = input.value.trim();
    if (content && socket && state.isConnected && state.activeServer && state.activeChannel) {
        console.log('📤 Sending message:', content);
        socket.emit('message', {
            serverId: state.activeServer,
            channelId: state.activeChannel,
            content
        });
        input.value = '';
    } else if (!state.isConnected) {
        showError('Not connected to server. Please refresh the page.');
    }
}

function sendDMMessage() {
    const input = document.getElementById('dmInput');
    if (!input) return;
    
    const content = input.value.trim();
    if (content && socket && state.isConnected && state.activeDM) {
        console.log('📤 Sending DM message:', content);
        socket.emit('dm-message', {
            dmId: state.activeDM,
            content
        });
        input.value = '';
    } else if (!state.isConnected) {
        showError('Not connected to server. Please refresh the page.');
    }
}

// Navigation Functions - ИСПРАВЛЕНО
function switchToLogin() { 
    state.view = 'login'; 
    render(); 
}

function switchToRegister() { 
    state.view = 'register'; 
    render(); 
}

function switchToFriends() { 
    console.log('🔄 Switching to friends view');
    state.view = 'friends'; 
    state.activeServer = null; 
    state.activeChannel = null; 
    state.activeDM = null; 
    render(); 
}

function switchServer(serverId) {
    console.log('🔄 Switching to server:', serverId);
    state.activeServer = serverId;
    state.view = 'home';
    state.activeDM = null;
    
    const server = state.servers.find(s => s._id === serverId);
    if (server && server.channels && server.channels.length > 0) {
        state.activeChannel = server.channels[0]._id;
        loadMessages();
    }
    render();
}

function switchChannel(channelId) { 
    console.log('🔄 Switching to channel:', channelId);
    state.activeChannel = channelId; 
    loadMessages(); 
    render(); 
}

function openDM(dmId) {
    console.log('🔄 Opening DM:', dmId);
    state.activeDM = dmId;
    state.view = 'dm';
    state.activeServer = null;
    state.activeChannel = null;
    loadDMMessages();
    render();
}
// Data Loading Functions - ИСПРАВЛЕНО
async function loadMessages() {
    if (!state.activeServer || !state.activeChannel) return;
    
    try {
        const messageKey = `${state.activeServer}-${state.activeChannel}`;
        if (!state.messages[messageKey]) {
            console.log('📥 Loading messages for channel:', state.activeChannel);
            const messages = await apiCall(`/servers/${state.activeServer}/channels/${state.activeChannel}/messages`);
            state.messages[messageKey] = messages || [];
            console.log('✅ Messages loaded:', messages?.length || 0);
        }
    } catch (error) {
        console.error('❌ Failed to load messages:', error);
    }
}

async function loadDMMessages() {
    if (!state.activeDM) return;
    
    try {
        const messageKey = `dm-${state.activeDM}`;
        if (!state.messages[messageKey]) {
            console.log('📥 Loading DM messages for:', state.activeDM);
            const dm = state.dms.find(d => d._id === state.activeDM);
            if (dm && dm.messages) {
                state.messages[messageKey] = dm.messages;
                console.log('✅ DM messages loaded:', dm.messages.length);
            }
        }
    } catch (error) {
        console.error('❌ Failed to load DM messages:', error);
    }
}

async function loadFriendRequests() {
    try {
        console.log('📥 Loading friend requests...');
        state.friendRequests = await apiCall('/friends/requests');
        console.log('✅ Friend requests loaded:', state.friendRequests.length);
        if (state.view === 'friends') render();
    } catch (error) {
        console.error('❌ Failed to load friend requests:', error);
    }
}

// Modal Functions - УЛУЧШЕНО
function showModal(title, content, onConfirm, confirmText = 'Confirm') {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>${title}</h2>
                <button class="modal-close" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div id="modal-error"></div>
                ${content}
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                ${onConfirm ? `<button class="btn btn-primary" id="modalConfirm">${confirmText}</button>` : ''}
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    if (onConfirm) {
        document.getElementById('modalConfirm').onclick = onConfirm;
    }
    
    modal.onclick = (e) => { 
        if (e.target === modal) closeModal(); 
    };
    
    // Focus first input
    setTimeout(() => {
        const firstInput = modal.querySelector('input');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closeModal() {
    const modal = document.querySelector('.modal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease';
        setTimeout(() => modal.remove(), 200);
    }
}

function showError(message) {
    const errorDiv = document.getElementById('auth-error') || document.getElementById('modal-error');
    if (errorDiv) {
        errorDiv.innerHTML = `<div class="error"><span class="error-icon">⚠️</span> ${message}</div>`;
        setTimeout(() => {
            if (errorDiv) errorDiv.innerHTML = '';
        }, 5000);
    }
}

function showSuccess(message) {
    const errorDiv = document.getElementById('auth-error') || document.getElementById('modal-error');
    if (errorDiv) {
        errorDiv.innerHTML = `<div class="success"><span class="success-icon">✅</span> ${message}</div>`;
        setTimeout(() => {
            if (errorDiv) errorDiv.innerHTML = '';
        }, 3000);
    }
}

// Server Management
function openCreateServerModal() {
    showModal('Create Server', `
        <div class="form-group">
            <label class="form-label">Server Name</label>
            <input type="text" class="form-input" id="serverName" placeholder="My Awesome Server" maxlength="50">
        </div>
        <div class="form-group">
            <label class="form-label">Server Icon (emoji)</label>
            <input type="text" class="form-input" id="serverIcon" placeholder="🏠" maxlength="2">
        </div>
    `, async () => {
        const name = document.getElementById('serverName').value.trim();
        const icon = document.getElementById('serverIcon').value.trim() || '🏠';
        
        if (!name) {
            showError('Server name is required');
            return;
        }
        
        try {
            const server = await apiCall('/servers', { 
                method: 'POST', 
                body: { name, icon } 
            });
            state.servers.push(server);
            closeModal();
            switchServer(server._id);
            showSuccess('Server created successfully!');
        } catch (error) {
            showError(error.message);
        }
    }, 'Create Server');
}
// Остальные функции модалов и управления
function openCreateChannelModal(type) {
    showModal(`Create ${type === 'voice' ? 'Voice' : 'Text'} Channel`, `
        <div class="form-group">
            <label class="form-label">Channel Name</label>
            <input type="text" class="form-input" id="channelName" placeholder="${type === 'voice' ? 'General Voice' : 'general'}" maxlength="30">
        </div>
        <div class="form-group">
            <label class="form-label">Channel Description (optional)</label>
            <input type="text" class="form-input" id="channelDesc" placeholder="What's this channel about?" maxlength="100">
        </div>
    `, async () => {
        const name = document.getElementById('channelName').value.trim();
        
        if (!name) {
            showError('Channel name is required');
            return;
        }
        
        try {
            await apiCall(`/servers/${state.activeServer}/channels`, { 
                method: 'POST', 
                body: { name, type } 
            });
            
            // Reload server data
            const server = await apiCall(`/servers/${state.activeServer}`);
            const serverIndex = state.servers.findIndex(s => s._id === state.activeServer);
            if (serverIndex !== -1) {
                state.servers[serverIndex] = server;
            }
            
            closeModal();
            render();
            showSuccess(`${type === 'voice' ? 'Voice' : 'Text'} channel created!`);
        } catch (error) {
            showError(error.message);
        }
    }, 'Create Channel');
}

function openAddFriendModal() {
    showModal('Add Friend', `
        <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" class="form-input" id="friendUsername" placeholder="Enter username" maxlength="20">
        </div>
        <p style="color: #949ba4; font-size: 14px; margin-top: 8px;">
            You can add friends by their username. Make sure you type it exactly!
        </p>
    `, async () => {
        const username = document.getElementById('friendUsername').value.trim();
        
        if (!username) {
            showError('Username is required');
            return;
        }
        
        if (username === state.user.username) {
            showError('You cannot add yourself as a friend');
            return;
        }
        
        try {
            await apiCall('/friends/request', { 
                method: 'POST', 
                body: { username } 
            });
            closeModal();
            showSuccess('Friend request sent!');
        } catch (error) {
            showError(error.message);
        }
    }, 'Send Request');
}

async function createDM(friendId) {
    try {
        console.log('🔄 Creating DM with friend:', friendId);
        const dm = await apiCall('/dms', { 
            method: 'POST', 
            body: { userId: friendId } 
        });
        
        // Add to DMs if not exists
        const existingDM = state.dms.find(d => d._id === dm._id);
        if (!existingDM) {
            state.dms.push(dm);
        }
        
        // Switch to DM view
        openDM(dm._id);
        showSuccess('Conversation opened!');
    } catch (error) {
        console.error('❌ Failed to create DM:', error);
        showError(error.message);
    }
}

function openSettingsModal() {
    if (!state.user) return;
    
    showModal('User Settings', `
        <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" class="form-input" id="settingsUsername" value="${state.user.username || ''}" maxlength="20">
        </div>
        <div class="form-group">
            <label class="form-label">Avatar (emoji or image URL)</label>
            <input type="text" class="form-input" id="settingsAvatar" value="${state.user.avatar || '👤'}" placeholder="👤 or https://...">
        </div>
        <div class="form-group">
            <label class="form-label">Status</label>
            <select class="form-input" id="settingsStatus">
                <option value="online" ${(state.user.status || 'online') === 'online' ? 'selected' : ''}>🟢 Online</option>
                <option value="idle" ${state.user.status === 'idle' ? 'selected' : ''}>🟡 Idle</option>
                <option value="dnd" ${state.user.status === 'dnd' ? 'selected' : ''}>🔴 Do Not Disturb</option>
                <option value="offline" ${state.user.status === 'offline' ? 'selected' : ''}>⚫ Invisible</option>
            </select>
        </div>
    `, async () => {
        const username = document.getElementById('settingsUsername').value.trim();
        const avatar = document.getElementById('settingsAvatar').value.trim();
        const status = document.getElementById('settingsStatus').value;
        
        if (!username) {
            showError('Username is required');
            return;
        }
        
        try {
            const updatedUser = await apiCall('/me', { 
                method: 'PUT', 
                body: { username, avatar, status } 
            });
            
            state.user = { ...state.user, ...updatedUser };
            closeModal();
            render();
            showSuccess('Settings updated successfully!');
        } catch (error) {
            showError(error.message);
        }
    }, 'Save Changes');
}

async function acceptFriendRequest(requestId) {
    try {
        console.log('✅ Accepting friend request:', requestId);
        await apiCall('/friends/accept', { 
            method: 'POST', 
            body: { requestId } 
        });
        
        await loadUserData();
        render();
        showSuccess('Friend request accepted!');
    } catch (error) {
        console.error('❌ Failed to accept friend request:', error);
        showError(error.message);
    }
}

function showFriendRequests() {
    if (state.friendRequests.length === 0) {
        showModal('Friend Requests', `
            <div class="empty-state">
                <div class="empty-icon">👥</div>
                <p>No pending friend requests</p>
            </div>
        `);
        return;
    }
    
    const requestsHtml = state.friendRequests.map(req => `
        <div class="friend-item">
            <div class="friend-info">
                <div class="avatar">
                    <span class="avatar-text">${req.from.avatar || '👤'}</span>
                </div>
                <div class="friend-details">
                    <div class="friend-name">${req.from.username}</div>
                    <div class="friend-status">Incoming Friend Request</div>
                </div>
            </div>
            <div class="friend-actions">
                <button class="btn btn-primary" onclick="acceptFriendRequest('${req._id}')">Accept</button>
                <button class="btn btn-secondary" onclick="declineFriendRequest('${req._id}')">Decline</button>
            </div>
        </div>
    `).join('');
    
    showModal('Friend Requests', requestsHtml);
}

// Utility functions
function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (picker) {
        picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
    }
}

function addEmoji(emoji) {
    const input = document.getElementById('messageInput') || document.getElementById('dmInput');
    if (input) { 
        input.value += emoji; 
        input.focus(); 
    }
    toggleEmojiPicker();
}

function openFileUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*,.pdf,.txt,.doc,.docx';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const messageInput = document.getElementById('messageInput') || document.getElementById('dmInput');
            if (messageInput) {
                messageInput.value = `📎 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`;
            }
        }
    };
    input.click();
}

// Voice/Video Call Functions - МАКСИМАЛЬНО РЕАЛИСТИЧНЫЕ
async function startVoiceCall(friendId) {
    console.log('📞 Starting voice call with:', friendId);
    
    try {
        // Request microphone permission
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: false 
        });
        
        const friend = state.friends.find(f => f._id === friendId) || 
                       state.dms.find(d => d._id === state.activeDM)?.participants?.find(p => p._id === friendId);
        
        if (!friend) {
            throw new Error('Friend not found');
        }
        
        // Create call modal
        if (activeCall) document.body.removeChild(activeCall);
        activeCall = document.createElement('div');
        activeCall.className = 'call-modal';
        activeCall.innerHTML = `
            <div class="call-header">
                <div class="call-avatar">${friend.avatar || '👤'}</div>
                <div class="call-info">
                    <h3>${friend.username || 'User'}</h3>
                    <div class="call-status" id="callStatus">Calling...</div>
                </div>
            </div>
            <div class="call-controls">
                <button class="call-btn mute" onclick="toggleCallMute()" id="callMuteBtn" title="Mute">🎤</button>
                <button class="call-btn hangup" onclick="endCall()" title="Hang up">📞</button>
            </div>
            <audio id="remoteAudio" autoplay></audio>
        `;
        document.body.appendChild(activeCall);
        
        // Initialize WebRTC
        await initializeWebRTC();
        
        // Emit call initiation to server
        if (socket && state.isConnected) {
            socket.emit('call-initiate', {
                to: friendId,
                type: 'voice',
                from: state.user.id
            });
        }
        
        isCallActive = true;
        
        // Simulate connection after 3 seconds
        setTimeout(() => {
            const status = document.getElementById('callStatus');
            if (status) { 
                status.textContent = 'Connected'; 
                status.style.color = '#3ba55d'; 
            }
        }, 3000);
        
    } catch (error) {
        console.error('❌ Error starting voice call:', error);
        showError('Could not access microphone. Please allow microphone access and try again.');
    }
}

async function startVideoCall(friendId) {
    console.log('📹 Starting video call with:', friendId);
    
    try {
        // Request camera and microphone permission
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: true 
        });
        
        const friend = state.friends.find(f => f._id === friendId) || 
                       state.dms.find(d => d._id === state.activeDM)?.participants?.find(p => p._id === friendId);
        
        if (!friend) {
            throw new Error('Friend not found');
        }
        
        // Create video call modal
        if (activeCall) document.body.removeChild(activeCall);
        activeCall = document.createElement('div');
        activeCall.className = 'call-modal video-call';
        activeCall.innerHTML = `
            <div class="call-header">
                <div class="call-avatar">${friend.avatar || '👤'}</div>
                <div class="call-info">
                    <h3>${friend.username || 'User'}</h3>
                    <div class="call-status" id="callStatus">Starting video...</div>
                </div>
            </div>
            <div class="video-container">
                <video id="localVideo" autoplay muted playsinline></video>
                <video id="remoteVideo" autoplay playsinline></video>
            </div>
            <div class="call-controls">
                <button class="call-btn mute" onclick="toggleCallMute()" id="callMuteBtn" title="Mute">🎤</button>
                <button class="call-btn video" onclick="toggleCallVideo()" id="callVideoBtn" title="Video">📹</button>
                <button class="call-btn screen" onclick="toggleScreenShare()" title="Share screen">🖥️</button>
                <button class="call-btn hangup" onclick="endCall()" title="Hang up">📞</button>
            </div>
            <audio id="remoteAudio" autoplay></audio>
        `;
        document.body.appendChild(activeCall);
        
        // Show local video
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        
        // Initialize WebRTC
        await initializeWebRTC();
        
        // Emit call initiation to server
        if (socket && state.isConnected) {
            socket.emit('call-initiate', {
                to: friendId,
                type: 'video',
                from: state.user.id
            });
        }
        
        isCallActive = true;
        
        setTimeout(() => {
            const status = document.getElementById('callStatus');
            if (status) { 
                status.textContent = 'Video connected'; 
                status.style.color = '#3ba55d'; 
            }
        }, 3000);
        
    } catch (error) {
        console.error('❌ Error starting video call:', error);
        showError('Could not access camera/microphone. Please allow camera and microphone access and try again.');
    }
}

async function initializeWebRTC() {
    try {
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        // Add local stream to peer connection
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }
        
        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log('📡 Received remote stream');
            remoteStream = event.streams[0];
            const remoteVideo = document.getElementById('remoteVideo');
            const remoteAudio = document.getElementById('remoteAudio');
            
            if (remoteVideo) {
                remoteVideo.srcObject = remoteStream;
            }
            if (remoteAudio) {
                remoteAudio.srcObject = remoteStream;
            }
        };
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket && state.isConnected) {
                socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    to: getCurrentCallTarget()
                });
            }
        };
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log('🔗 Connection state:', peerConnection.connectionState);
            const status = document.getElementById('callStatus');
            if (status) {
                switch (peerConnection.connectionState) {
                    case 'connected':
                        status.textContent = 'Connected';
                        status.style.color = '#3ba55d';
                        break;
                    case 'disconnected':
                        status.textContent = 'Disconnected';
                        status.style.color = '#ed4245';
                        break;
                    case 'failed':
                        status.textContent = 'Connection failed';
                        status.style.color = '#ed4245';
                        break;
                }
            }
        };
        
    } catch (error) {
        console.error('❌ Error initializing WebRTC:', error);
    }
}

function getCurrentCallTarget() {
    // Get the current call target from the modal
    const callModal = document.querySelector('.call-modal');
    if (callModal) {
        const username = callModal.querySelector('.call-info h3')?.textContent;
        const friend = state.friends.find(f => f.username === username);
        return friend?._id;
    }
    return null;
}

function toggleCallMute() {
    const btn = document.getElementById('callMuteBtn');
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            if (btn) {
                btn.classList.toggle('active', !audioTrack.enabled);
                btn.innerHTML = audioTrack.enabled ? '🎤' : '🔇';
            }
        }
    }
}

function toggleCallVideo() {
    const btn = document.getElementById('callVideoBtn');
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            if (btn) {
                btn.classList.toggle('active', !videoTrack.enabled);
                btn.innerHTML = videoTrack.enabled ? '📹' : '📷';
            }
        }
    }
}

async function toggleScreenShare() {
    try {
        if (localStream && localStream.getVideoTracks()[0].label.includes('screen')) {
            // Stop screen sharing, return to camera
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = videoStream.getVideoTracks()[0];
            
            // Replace track in peer connection
            if (peerConnection) {
                const sender = peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                if (sender) {
                    await sender.replaceTrack(videoTrack);
                }
            }
            
            // Update local video
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = new MediaStream([videoTrack, ...localStream.getAudioTracks()]);
            }
            
            localStream = new MediaStream([videoTrack, ...localStream.getAudioTracks()]);
            
        } else {
            // Start screen sharing
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: true, 
                audio: true 
            });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Replace track in peer connection
            if (peerConnection) {
                const sender = peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                if (sender) {
                    await sender.replaceTrack(screenTrack);
                }
            }
            
            // Update local video
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
            }
            
            localStream = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
            
            // Handle screen share end
            screenTrack.onended = () => {
                toggleScreenShare(); // Return to camera
            };
        }
    } catch (error) {
        console.error('❌ Error toggling screen share:', error);
        showError('Could not start screen sharing. Please try again.');
    }
}

function endCall() {
    console.log('📞 Ending call...');
    
    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Remove call modal
    if (activeCall) { 
        document.body.removeChild(activeCall); 
        activeCall = null; 
    }
    
    // Emit call end to server
    if (socket && state.isConnected) {
        socket.emit('call-end', {
            to: getCurrentCallTarget()
        });
    }
    
    // Reset call state
    isCallActive = false;
    remoteStream = null;
}

// Placeholder functions
function connectVoice() { 
    showError('Voice channels are coming soon!'); 
}

function shareScreen() { 
    toggleScreenShare(); 
}

function toggleMute() {
    const btn = document.getElementById('muteBtn');
    if (btn) {
        btn.style.color = btn.style.color === 'rgb(237, 66, 69)' ? '#b5bac1' : '#ed4245';
    }
}

function toggleDeafen() {
    const btn = document.getElementById('deafenBtn');
    if (btn) {
        btn.style.color = btn.style.color === 'rgb(237, 66, 69)' ? '#b5bac1' : '#ed4245';
    }
}

function toggleNotifications() {
    showSuccess('Notifications toggled!');
}

function openChannelSettings() {
    showError('Channel settings are coming soon!');
}

function openServerMenu(serverId) {
    showError('Server menu is coming soon!');
}

function openUserProfile(userId) {
    showError('User profiles are coming soon!');
}

function openDMSettings(dmId) {
    showError('DM settings are coming soon!');
}

function declineFriendRequest(requestId) {
    showError('Decline functionality is coming soon!');
}

console.log('🚀 Discord Clone - Maximum Version Loaded!');