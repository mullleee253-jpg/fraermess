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
    
    // Check for invite code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('invite');
    if (inviteCode) {
        console.log('📨 Invite code detected:', inviteCode);
        localStorage.setItem('pendingInvite', inviteCode);
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
    
    // Проверяем base64 изображения
    if (content.startsWith('data:image/')) {
        return `<img src="${content}" alt="Image" onclick="window.open('${content}', '_blank')" style="max-width: 400px; max-height: 300px; border-radius: 8px; cursor: pointer; margin-top: 8px; display: block;">`;
    }
    
    // Проверяем URL изображений (более гибкое регулярное выражение)
    const imageRegex = /^https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?$/i;
    const imageInTextRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?)/gi;
    
    // Если всё сообщение - это изображение
    if (imageRegex.test(content.trim())) {
        return `<img src="${content.trim()}" alt="Image" onclick="window.open('${content.trim()}', '_blank')" style="max-width: 400px; max-height: 300px; border-radius: 8px; cursor: pointer; margin-top: 8px; display: block;">`;
    }
    
    // Заменяем изображения в тексте
    content = content.replace(imageInTextRegex, '<img src="$1" alt="Image" onclick="window.open(\'$1\', \'_blank\')" style="max-width: 400px; max-height: 300px; border-radius: 8px; cursor: pointer; margin-top: 8px; display: block;">');
    
    // Заменяем обычные ссылки
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    content = content.replace(urlRegex, (url) => {
        // Не заменяем если это уже часть img тега
        if (content.includes(`src="${url}"`)) return url;
        return `<a href="${url}" target="_blank" style="color: #00a8fc; text-decoration: none;">${url}</a>`;
    });
    
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

        console.log('📊 Registration response:', data);
        console.log('📊 User object:', data.user);
        console.log('📊 User ID:', data.user?.id);
        console.log('📊 User _id:', data.user?._id);

        state.token = data.token;
        state.user = data.user;
        
        // ИСПРАВЛЕНИЕ: Убедимся что user.id установлен
        if (!state.user.id && state.user._id) {
            console.warn('⚠️ user.id missing, using _id instead');
            state.user.id = state.user._id;
        }
        
        localStorage.setItem('token', data.token);
        
        console.log('✅ Registration successful, final state.user:', state.user);
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

        console.log('📊 Login response:', data);
        console.log('📊 User object:', data.user);
        console.log('📊 User ID:', data.user?.id);
        console.log('📊 User _id:', data.user?._id);

        state.token = data.token;
        state.user = data.user;
        
        // ИСПРАВЛЕНИЕ: Убедимся что user.id установлен
        if (!state.user.id && state.user._id) {
            console.warn('⚠️ user.id missing, using _id instead');
            state.user.id = state.user._id;
        }
        
        localStorage.setItem('token', data.token);
        
        console.log('✅ Login successful, final state.user:', state.user);
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
        console.log('📊 User data received from API:', user);
        console.log('📊 User ID:', user.id);
        console.log('📊 User _id:', user._id);
        
        state.user = user;
        
        // ИСПРАВЛЕНИЕ: Убедимся что user.id установлен
        if (!state.user.id && state.user._id) {
            console.warn('⚠️ user.id missing, using _id instead');
            state.user.id = state.user._id;
        }
        
        console.log('✅ Final state.user:', state.user);
        
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
        
        // Check for pending invite
        const pendingInvite = localStorage.getItem('pendingInvite');
        if (pendingInvite) {
            console.log('📨 Processing pending invite:', pendingInvite);
            localStorage.removeItem('pendingInvite');
            await joinServerByInvite(pendingInvite);
            return; // Will reload after joining
        }
        
        // Set default server/channel
        if (state.servers.length > 0 && !state.activeServer) {
            state.activeServer = state.servers[0]._id;
            if (state.servers[0].channels && state.servers[0].channels.length > 0) {
                state.activeChannel = state.servers[0].channels[0]._id;
                // ИСПРАВЛЕНИЕ: Загружаем сообщения для первого канала
                await loadMessages();
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
        
        // ИСПРАВЛЕНИЕ: Если сокет уже подключен, отправим join заново
        if (state.user && state.user.id) {
            console.log('🔄 Re-sending join event for already connected socket');
            const joinData = {
                userId: state.user.id,
                servers: state.servers.map(s => s._id)
            };
            console.log('📤 Emitting join event with data:', joinData);
            socket.emit('join', joinData);
        }
        return;
    }
    
    if (!state.user || !state.user.id) {
        console.error('❌ CRITICAL: Cannot connect socket - user not loaded yet!');
        console.log('state.user:', state.user);
        return;
    }
    
    console.log('🔌 Connecting to socket...');
    console.log('👤 Current user:', state.user);
    
    socket = io({
        transports: ['websocket', 'polling'],
        timeout: 20000,
        forceNew: true,
        autoConnect: true
    });
    
    socket.on('connect', () => {
        console.log('✅ Socket connected:', socket.id);
        state.isConnected = true;
        
        // Initialize Call Manager
        if (typeof initCallManager === 'function') {
            initCallManager();
        }
        
        // Join user rooms
        if (state.user && state.user.id) {
            console.log('📡 Joining rooms for user:', state.user.id);
            console.log('📊 User object:', state.user);
            console.log('📊 Servers:', state.servers.map(s => s._id));
            
            const joinData = {
                userId: state.user.id,
                servers: state.servers.map(s => s._id)
            };
            
            console.log('📤 Emitting join event with data:', joinData);
            socket.emit('join', joinData);
            
            // ИСПРАВЛЕНИЕ: Проверяем что join-success пришел
            setTimeout(() => {
                if (!socket.joinSuccessReceived) {
                    console.error('❌ CRITICAL: join-success not received after 3 seconds!');
                    console.log('🔄 Trying to emit join again...');
                    socket.emit('join', joinData);
                }
            }, 3000);
        } else {
            console.error('❌ CRITICAL: state.user or state.user.id is missing!');
            console.log('state.user:', state.user);
        }
        
        // Update connection status in UI
        updateConnectionStatus(true);
    });
    
    socket.on('join-success', (data) => {
        console.log('✅ Successfully joined rooms:', data);
        socket.joinSuccessReceived = true;
        state.isConnected = true;
        updateConnectionStatus(true);
    });
    
    socket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error);
        state.isConnected = false;
        updateConnectionStatus(false);
    });
    
    socket.on('disconnect', (reason) => {
        console.log('❌ Socket disconnected:', reason);
        state.isConnected = false;
        updateConnectionStatus(false);
        
        // Try to reconnect after 3 seconds
        setTimeout(() => {
            if (!socket.connected) {
                console.log('🔄 Attempting to reconnect...');
                socket.connect();
            }
        }, 3000);
    });
    
    // Test response handler
    socket.on('test-response', (data) => {
        console.log('✅ Test response received:', data);
        showSuccess('Connection test successful!');
    });
    
    // REAL-TIME MESSAGES - ИСПРАВЛЕНО
    socket.on('message', (data) => {
        console.log('📨 New message received:', data);
        const { serverId, channelId, message } = data;
        
        if (!message) {
            console.error('❌ Message is null or undefined');
            return;
        }
        
        const key = `${serverId}-${channelId}`;
        
        if (!state.messages[key]) {
            state.messages[key] = [];
        }
        
        // Проверяем не дубликат ли это (удаляем временное сообщение если есть)
        const tempIndex = state.messages[key].findIndex(m => 
            m._id && m._id.toString().startsWith('temp-') && 
            m.content === message.content &&
            m.author?._id === message.author?._id
        );
        
        if (tempIndex !== -1) {
            console.log('🔄 Replacing temp message with real one');
            state.messages[key][tempIndex] = message;
        } else {
            // Добавляем только если это не наше временное сообщение
            state.messages[key].push(message);
        }
        
        console.log('👤 Message author:', message.author?.username);
        
        // Update UI if we're viewing this channel
        if (state.activeServer === serverId && state.activeChannel === channelId && state.view === 'home') {
            console.log('🔄 Updating chat UI with new message');
            render();
            scrollToBottom();
        }
        
        // Show notification if not focused
        if (document.hidden && Notification.permission === 'granted' && message.author) {
            new Notification(`${message.author.username}`, {
                body: message.content,
                icon: message.author.avatar || '💬'
            });
        }
    });

    // REAL-TIME DM MESSAGES - ИСПРАВЛЕНО
    socket.on('dm-message', (data) => {
        console.log('📨 New DM message received:', data);
        const { dmId, message } = data;
        
        if (!message) {
            console.error('❌ DM message is null or undefined');
            return;
        }
        
        const key = `dm-${dmId}`;
        
        if (!state.messages[key]) {
            state.messages[key] = [];
        }
        
        // Проверяем не дубликат ли это (удаляем временное сообщение если есть)
        const tempIndex = state.messages[key].findIndex(m => 
            m._id && m._id.toString().startsWith('temp-') && 
            m.content === message.content &&
            m.author?._id === message.author?._id
        );
        
        if (tempIndex !== -1) {
            console.log('🔄 Replacing temp DM message with real one');
            state.messages[key][tempIndex] = message;
        } else {
            // Добавляем только если это не наше временное сообщение
            state.messages[key].push(message);
        }
        
        console.log('👤 DM message author:', message.author?.username);
        
        // Update UI if we're viewing this DM
        if (state.activeDM === dmId && state.view === 'dm') {
            console.log('🔄 Updating DM UI with new message');
            render();
            scrollToBottom();
        }
        
        // Show notification
        if (document.hidden && Notification.permission === 'granted' && message.author) {
            new Notification(`${message.author.username} (DM)`, {
                body: message.content,
                icon: message.author.avatar || '💬'
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
        if (connected && socket && socket.joinSuccessReceived) {
            statusEl.textContent = '🟢 Connected';
            statusEl.style.color = '#3ba55d';
        } else if (connected) {
            statusEl.textContent = '🟡 Connecting...';
            statusEl.style.color = '#faa61a';
        } else {
            statusEl.textContent = '🔴 Disconnected';
            statusEl.style.color = '#ed4245';
        }
    }
    
    // Add debug info to console
    console.log(`🔗 Connection status: ${connected ? 'CONNECTED' : 'DISCONNECTED'}`);
    if (connected && socket) {
        console.log('📊 Socket info:', {
            id: socket.id,
            connected: socket.connected,
            joinSuccessReceived: socket.joinSuccessReceived || false,
            userId: state.user?.id || 'not set'
        });
    }
}

// Debug function to test connection
function testConnection() {
    console.log('🧪 Testing connection...');
    console.log('Socket:', socket);
    console.log('Connected:', socket?.connected);
    console.log('State:', {
        isConnected: state.isConnected,
        user: state.user?.username,
        activeServer: state.activeServer,
        activeChannel: state.activeChannel
    });
    
    if (socket && socket.connected) {
        socket.emit('test', { message: 'Hello from client!' });
    }
}

// Make testConnection available globally for debugging
window.testConnection = testConnection;
// UI Rendering Functions - МАКСИМАЛЬНО УЛУЧШЕННЫЙ ИНТЕРФЕЙС
function render() {
    const app = document.getElementById('app');
    
    console.log('🎨 Rendering view:', state.view);
    
    if (state.view === 'login') {
        app.innerHTML = renderLogin();
    } else if (state.view === 'register') {
        app.innerHTML = renderRegister();
    } else if (state.view === 'friends') {
        app.innerHTML = renderFriends();
    } else if (state.view === 'dm') {
        console.log('💬 Rendering DM view for:', state.activeDM);
        app.innerHTML = renderDM();
    } else {
        app.innerHTML = renderMain();
    }
    
    // Auto-scroll to bottom after render
    setTimeout(() => {
        scrollToBottom();
        updateConnectionStatus(state.isConnected);
    }, 100);
    
    console.log('✅ Render complete');
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
                                ${friend.avatar && friend.avatar.startsWith('data:') ? 
                                    `<img src="${friend.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">` :
                                    `<span class="avatar-text">${friend.avatar || '👤'}</span>`
                                }
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
                    ${state.user.avatar && state.user.avatar.startsWith('data:') ? 
                        `<img src="${state.user.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">` :
                        `<span class="avatar-text">${state.user.avatar || '👤'}</span>`
                    }
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
                        ${author.avatar && author.avatar.startsWith('data:') ? 
                            `<img src="${author.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">` :
                            `<span class="avatar-text">${author.avatar}</span>`
                        }
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
    const isDM = state.view === 'dm';
    
    console.log('📝 renderMessageInput called:', {
        view: state.view,
        isDM: isDM,
        activeDM: state.activeDM,
        activeServer: state.activeServer,
        activeChannel: state.activeChannel
    });
    
    const placeholder = isDM ? 
        `Message @${state.dms.find(d => d._id === state.activeDM)?.participants?.find(p => p._id !== state.user.id)?.username || 'User'}` :
        `Message #${state.servers.find(s => s._id === state.activeServer)?.channels?.find(c => c._id === state.activeChannel)?.name || 'channel'}`;
    
    const inputId = isDM ? 'dmInput' : 'messageInput';
    const sendFunction = isDM ? 'sendDMMessage()' : 'sendMessage()';
    const keyPressHandler = isDM ? 'handleDMInput(event)' : 'handleMessageInput(event)';
    
    console.log('📝 Input config:', {
        inputId,
        sendFunction,
        keyPressHandler
    });
    
    return `
        <div class="input-wrapper">
            <div class="input-container">
                <input type="text" 
                       placeholder="${placeholder}" 
                       onkeypress="${keyPressHandler}" 
                       id="${inputId}" 
                       class="message-input"
                       autocomplete="off">
                <div class="input-controls">
                    <button class="input-btn" onclick="openFileUpload()" title="Upload file">📎</button>
                    <button class="input-btn" onclick="toggleEmojiPicker()" title="Add emoji">😀</button>
                    <button class="input-btn send-btn" onclick="${sendFunction}" title="Send message">➤</button>
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
                                ${f.avatar && f.avatar.startsWith('data:') ? 
                                    `<img src="${f.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">` :
                                    `<span class="avatar-text">${f.avatar || '👤'}</span>`
                                }
                                <div class="status ${f.status || 'offline'}"></div>
                            </div>
                            <div class="friend-details">
                                <div class="friend-name">${f.username}</div>
                                <div class="friend-status">${f.status || 'offline'}</div>
                            </div>
                        </div>
                        <div class="friend-actions">
                            <button class="header-btn" onclick="event.stopPropagation(); createDM('${f._id}')" title="Message">💬</button>
                            <button class="header-btn" onclick="event.stopPropagation(); startVoiceCall('${f._id}')" title="Call">📞</button>
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
                        ${friend.avatar && friend.avatar.startsWith('data:') ? 
                            `<img src="${friend.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">` :
                            `<span class="avatar-text">${friend.avatar || '👤'}</span>`
                        }
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
    
    // Сегодня
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    
    // Сегодня - показываем время
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date >= today) {
        return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Вчера
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date >= yesterday) {
        return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Старше - показываем дату и время
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
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
        console.log('⌨️ Enter pressed in SERVER message input');
        sendMessage();
    }
}

function handleDMInput(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        console.log('⌨️ Enter pressed in DM message input');
        sendDMMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input) {
        console.error('❌ Message input not found');
        return;
    }
    
    const content = input.value.trim();
    console.log('📝 [SERVER MESSAGE] Attempting to send:', content);
    console.log('🔍 State:', {
        view: state.view,
        activeServer: state.activeServer,
        activeChannel: state.activeChannel,
        activeDM: state.activeDM,
        userId: state.user?.id,
        username: state.user?.username
    });
    console.log('🔍 Socket state:', {
        connected: socket?.connected,
        id: socket?.id
    });
    
    if (!content) {
        console.warn('⚠️ Empty message');
        return;
    }
    
    if (state.view === 'dm') {
        console.error('❌ WRONG! In DM view but using sendMessage()');
        showError('Error: Wrong message handler. Please refresh.');
        return;
    }
    
    if (!socket || !socket.connected) {
        console.error('❌ Socket not connected');
        showError('Not connected to server. Trying to reconnect...');
        connectSocket();
        return;
    }
    
    if (!state.activeServer || !state.activeChannel) {
        console.error('❌ No active server/channel');
        showError('Please select a channel first.');
        return;
    }
    
    if (!state.user || !state.user.id) {
        console.error('❌ CRITICAL: User not logged in or user.id missing!');
        console.log('state.user:', state.user);
        showError('User not authenticated. Please refresh and login again.');
        return;
    }
    
    console.log('📤 [SERVER MESSAGE] Sending via socket...');
    
    // Добавляем сообщение локально СРАЗУ для мгновенного отображения
    const tempMessage = {
        _id: 'temp-' + Date.now(),
        content: content,
        author: {
            _id: state.user.id,
            username: state.user.username,
            avatar: state.user.avatar
        },
        timestamp: new Date()
    };
    
    const key = `${state.activeServer}-${state.activeChannel}`;
    if (!state.messages[key]) {
        state.messages[key] = [];
    }
    state.messages[key].push(tempMessage);
    
    // Обновляем UI сразу
    render();
    scrollToBottom();
    
    const messageData = {
        serverId: state.activeServer,
        channelId: state.activeChannel,
        content
    };
    
    console.log('📤 Emitting message event with data:', messageData);
    
    // Отправляем на сервер
    socket.emit('message', messageData);
    
    input.value = '';
    console.log('✅ [SERVER MESSAGE] Sent successfully');
}

function sendDMMessage() {
    const input = document.getElementById('dmInput');
    if (!input) {
        console.error('❌ DM input not found');
        return;
    }
    
    const content = input.value.trim();
    console.log('📝 [DM MESSAGE] Attempting to send:', content);
    console.log('🔍 DM State:', {
        view: state.view,
        activeDM: state.activeDM,
        activeServer: state.activeServer,
        activeChannel: state.activeChannel
    });
    
    if (!content) {
        console.warn('⚠️ Empty DM message');
        return;
    }
    
    if (state.view !== 'dm') {
        console.error('❌ WRONG! Not in DM view but using sendDMMessage()');
        showError('Error: Wrong message handler. Please refresh.');
        return;
    }
    
    if (!socket || !socket.connected) {
        console.error('❌ Socket not connected');
        showError('Not connected to server. Trying to reconnect...');
        connectSocket();
        return;
    }
    
    if (!state.activeDM) {
        console.error('❌ No active DM');
        showError('Please select a conversation first.');
        return;
    }
    
    console.log('📤 [DM MESSAGE] Sending via socket...');
    
    // Добавляем сообщение локально СРАЗУ для мгновенного отображения
    const tempMessage = {
        _id: 'temp-' + Date.now(),
        content: content,
        author: {
            _id: state.user.id,
            username: state.user.username,
            avatar: state.user.avatar
        },
        timestamp: new Date()
    };
    
    const key = `dm-${state.activeDM}`;
    if (!state.messages[key]) {
        state.messages[key] = [];
    }
    state.messages[key].push(tempMessage);
    
    // Обновляем UI сразу
    render();
    scrollToBottom();
    
    // Отправляем на сервер
    socket.emit('dm-message', {
        dmId: state.activeDM,
        content
    });
    
    input.value = '';
    console.log('✅ [DM MESSAGE] Sent successfully');
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
    
    // Сначала рендерим UI сразу
    render();
    
    // Потом загружаем сообщения в фоне
    loadDMMessages();
}
// Data Loading Functions - ИСПРАВЛЕНО
async function loadMessages() {
    if (!state.activeServer || !state.activeChannel) return;
    
    try {
        const messageKey = `${state.activeServer}-${state.activeChannel}`;
        // ИСПРАВЛЕНИЕ: Всегда загружаем сообщения заново, не проверяем кэш
        console.log('📥 Loading messages for channel:', state.activeChannel);
        const messages = await apiCall(`/servers/${state.activeServer}/channels/${state.activeChannel}/messages`);
        state.messages[messageKey] = messages || [];
        console.log('✅ Messages loaded:', messages?.length || 0);
        render();
    } catch (error) {
        console.error('❌ Failed to load messages:', error);
    }
}

async function loadDMMessages() {
    if (!state.activeDM) return;
    
    try {
        const messageKey = `dm-${state.activeDM}`;
        
        // Проверяем кэш - если сообщения уже загружены, не загружаем заново
        if (state.messages[messageKey] && state.messages[messageKey].length > 0) {
            console.log('✅ Using cached DM messages:', state.messages[messageKey].length);
            return;
        }
        
        console.log('📥 Loading DM messages for:', state.activeDM);
        
        // Загружаем только этот конкретный DM
        const dm = state.dms.find(d => d._id === state.activeDM);
        if (dm && dm.messages) {
            state.messages[messageKey] = dm.messages;
            console.log('✅ DM messages loaded:', dm.messages.length);
            render();
        } else {
            // Если нет в кэше, загружаем с сервера
            const dms = await apiCall('/dms');
            const freshDm = dms.find(d => d._id === state.activeDM);
            if (freshDm && freshDm.messages) {
                state.messages[messageKey] = freshDm.messages;
                console.log('✅ DM messages loaded from server:', freshDm.messages.length);
                render();
            } else {
                state.messages[messageKey] = [];
                render();
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
        
        // Сначала проверяем, есть ли уже DM с этим другом
        const existingDM = state.dms.find(d => 
            d.participants && d.participants.some(p => p._id === friendId)
        );
        
        if (existingDM) {
            // Если DM уже существует, просто открываем его
            console.log('✅ DM already exists, opening:', existingDM._id);
            openDM(existingDM._id);
            return;
        }
        
        // Если нет, создаем новый
        const dm = await apiCall('/dms', { 
            method: 'POST', 
            body: { userId: friendId } 
        });
        
        // Добавляем в список
        state.dms.push(dm);
        
        // Открываем DM
        openDM(dm._id);
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
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Проверка размера (макс 5MB)
        if (file.size > 5 * 1024 * 1024) {
            showError('File too large! Max size is 5MB');
            return;
        }
        
        // Проверка типа
        if (!file.type.startsWith('image/')) {
            showError('Only images are supported');
            return;
        }
        
        // Показываем индикатор загрузки
        const messageInput = document.getElementById('messageInput') || document.getElementById('dmInput');
        if (messageInput) {
            messageInput.value = '📤 Uploading image...';
            messageInput.disabled = true;
        }
        
        // Конвертируем в base64
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target.result;
            
            // Отправляем как сообщение
            if (state.view === 'dm') {
                await sendImageMessage(base64, true);
            } else {
                await sendImageMessage(base64, false);
            }
            
            // Очищаем input
            if (messageInput) {
                messageInput.value = '';
                messageInput.disabled = false;
                messageInput.focus();
            }
        };
        
        reader.onerror = () => {
            showError('Failed to read file');
            if (messageInput) {
                messageInput.value = '';
                messageInput.disabled = false;
            }
        };
        
        reader.readAsDataURL(file);
    };
    input.click();
}

async function sendImageMessage(base64Image, isDM) {
    try {
        if (isDM) {
            if (!socket || !socket.connected) {
                showError('Not connected to server');
                return;
            }
            
            if (!state.activeDM) {
                showError('No active DM');
                return;
            }
            
            // Добавляем локально
            const tempMessage = {
                _id: 'temp-' + Date.now(),
                content: base64Image,
                author: {
                    _id: state.user.id,
                    username: state.user.username,
                    avatar: state.user.avatar
                },
                timestamp: new Date()
            };
            
            const key = `dm-${state.activeDM}`;
            if (!state.messages[key]) {
                state.messages[key] = [];
            }
            state.messages[key].push(tempMessage);
            render();
            scrollToBottom();
            
            // Отправляем на сервер
            socket.emit('dm-message', {
                dmId: state.activeDM,
                content: base64Image
            });
        } else {
            if (!socket || !socket.connected) {
                showError('Not connected to server');
                return;
            }
            
            if (!state.activeServer || !state.activeChannel) {
                showError('No active channel');
                return;
            }
            
            // Добавляем локально
            const tempMessage = {
                _id: 'temp-' + Date.now(),
                content: base64Image,
                author: {
                    _id: state.user.id,
                    username: state.user.username,
                    avatar: state.user.avatar
                },
                timestamp: new Date()
            };
            
            const key = `${state.activeServer}-${state.activeChannel}`;
            if (!state.messages[key]) {
                state.messages[key] = [];
            }
            state.messages[key].push(tempMessage);
            render();
            scrollToBottom();
            
            // Отправляем на сервер
            socket.emit('message', {
                serverId: state.activeServer,
                channelId: state.activeChannel,
                content: base64Image
            });
        }
        
        showSuccess('Image sent!');
    } catch (error) {
        console.error('Failed to send image:', error);
        showError('Failed to send image');
    }
}

// Voice/Video Call Functions - moved to calls.js

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


// ============================================
// SERVER MANAGEMENT FUNCTIONS
// ============================================

// Open server settings modal
function openServerMenu(serverId) {
    const server = state.servers.find(s => s._id === serverId);
    if (!server) return;
    
    const isOwner = server.owner === state.user.id;
    
    showModal('Server Settings', `
        <div class="server-menu">
            <h3>${server.icon} ${server.name}</h3>
            <div class="menu-section">
                <button class="btn btn-primary" onclick="openInviteModal('${serverId}')">
                    🔗 Create Invite
                </button>
                ${isOwner ? `
                    <button class="btn btn-secondary" onclick="openRolesModal('${serverId}')">
                        👑 Manage Roles
                    </button>
                    <button class="btn btn-secondary" onclick="openServerSettings('${serverId}')">
                        ⚙️ Server Settings
                    </button>
                ` : ''}
                <button class="btn btn-secondary" onclick="closeModal()">
                    ❌ Close
                </button>
            </div>
        </div>
    `);
}

// Create server invite
async function openInviteModal(serverId) {
    try {
        const result = await apiCall(`/servers/${serverId}/invites`, {
            method: 'POST'
        });
        
        const inviteUrl = result.url;
        
        showModal('Invite Link Created', `
            <div class="invite-modal">
                <p>Share this link to invite people to the server:</p>
                <div class="invite-link-box">
                    <input type="text" value="${inviteUrl}" id="inviteLink" readonly 
                           style="width: 100%; padding: 12px; background: #2f3339; border: 1px solid #4a9eff; 
                                  border-radius: 8px; color: #e4e6eb; font-size: 14px; margin: 12px 0;">
                </div>
                <button class="btn btn-primary" onclick="copyInviteLink()">
                    📋 Copy Link
                </button>
            </div>
        `);
    } catch (error) {
        showError('Failed to create invite: ' + error.message);
    }
}

function copyInviteLink() {
    const input = document.getElementById('inviteLink');
    if (input) {
        input.select();
        document.execCommand('copy');
        showSuccess('Invite link copied!');
    }
}

// Open server settings
async function openServerSettings(serverId) {
    const server = state.servers.find(s => s._id === serverId);
    if (!server) return;
    
    showModal('Server Settings', `
        <div class="server-settings">
            <div class="form-group">
                <label class="form-label">Server Name</label>
                <input type="text" class="form-input" id="serverName" value="${server.name}" maxlength="50">
            </div>
            
            <div class="form-group">
                <label class="form-label">Server Icon (emoji)</label>
                <input type="text" class="form-input" id="serverIcon" value="${server.icon || '🏠'}" maxlength="2">
            </div>
            
            <div class="form-group">
                <label class="form-label">Server Avatar</label>
                <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 12px;">
                    <div class="avatar" style="width: 64px; height: 64px; font-size: 32px;">
                        ${server.avatar && server.avatar.startsWith('data:') ? 
                            `<img src="${server.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">` :
                            `<span class="avatar-text">${server.icon || '🏠'}</span>`
                        }
                    </div>
                    <button class="btn btn-secondary" onclick="uploadServerAvatar('${serverId}')">
                        📷 Upload Avatar
                    </button>
                </div>
            </div>
            
            <div class="form-group">
                <label class="form-label">Manage Channels</label>
                <div style="max-height: 200px; overflow-y: auto; background: #2f3339; border-radius: 8px; padding: 8px;">
                    ${server.channels.map(c => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; margin: 4px 0; background: #1a1d23; border-radius: 6px;">
                            <span style="color: #e4e6eb;">${c.type === 'voice' ? '🔊' : '#'} ${c.name}</span>
                            ${server.channels.length > 1 ? `
                                <button class="btn btn-secondary" style="padding: 4px 12px; font-size: 12px;" 
                                        onclick="deleteChannel('${serverId}', '${c._id}')">
                                    🗑️ Delete
                                </button>
                            ` : '<span style="color: #8b92a0; font-size: 12px;">Default channel</span>'}
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="form-group">
                <label class="form-label">Assign Roles to Members</label>
                <button class="btn btn-secondary" onclick="openAssignRolesModal('${serverId}')">
                    👥 Manage Member Roles
                </button>
            </div>
        </div>
    `, async () => {
        await saveServerSettings(serverId);
    }, 'Save Changes');
}

async function saveServerSettings(serverId) {
    const name = document.getElementById('serverName').value.trim();
    const icon = document.getElementById('serverIcon').value.trim();
    
    if (!name) {
        showError('Server name cannot be empty');
        return;
    }
    
    try {
        const server = await apiCall(`/servers/${serverId}`, {
            method: 'PUT',
            body: { name, icon }
        });
        
        // Update local state
        const serverIndex = state.servers.findIndex(s => s._id === serverId);
        if (serverIndex !== -1) {
            state.servers[serverIndex] = server;
        }
        
        closeModal();
        render();
        showSuccess('Server settings saved!');
    } catch (error) {
        showError('Failed to save settings: ' + error.message);
    }
}

function uploadServerAvatar(serverId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (file.size > 2 * 1024 * 1024) {
            showError('Image too large! Max size is 2MB');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target.result;
            
            try {
                const server = await apiCall(`/servers/${serverId}`, {
                    method: 'PUT',
                    body: { avatar: base64 }
                });
                
                // Update local state
                const serverIndex = state.servers.findIndex(s => s._id === serverId);
                if (serverIndex !== -1) {
                    state.servers[serverIndex] = server;
                }
                
                closeModal();
                openServerSettings(serverId);
                showSuccess('Server avatar updated!');
            } catch (error) {
                showError('Failed to upload avatar: ' + error.message);
            }
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

async function deleteChannel(serverId, channelId) {
    if (!confirm('Are you sure you want to delete this channel?')) return;
    
    try {
        const server = await apiCall(`/servers/${serverId}/channels/${channelId}`, {
            method: 'DELETE'
        });
        
        // Update local state
        const serverIndex = state.servers.findIndex(s => s._id === serverId);
        if (serverIndex !== -1) {
            state.servers[serverIndex] = server;
        }
        
        closeModal();
        openServerSettings(serverId);
        showSuccess('Channel deleted!');
    } catch (error) {
        showError('Failed to delete channel: ' + error.message);
    }
}

async function openAssignRolesModal(serverId) {
    const server = state.servers.find(s => s._id === serverId);
    if (!server) return;
    
    const membersHtml = server.members.map(member => {
        const memberRoles = server.roles.filter(r => r.members && r.members.includes(member._id));
        
        return `
            <div style="padding: 12px; margin: 8px 0; background: #2f3339; border-radius: 8px;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                    <div class="avatar" style="width: 32px; height: 32px; font-size: 16px;">
                        ${member.avatar && member.avatar.startsWith('data:') ? 
                            `<img src="${member.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">` :
                            `<span class="avatar-text">${member.avatar || '👤'}</span>`
                        }
                    </div>
                    <span style="color: #e4e6eb; font-weight: 600;">${member.username}</span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${server.roles.map(role => {
                        const hasRole = memberRoles.some(r => r._id === role._id);
                        return `
                            <button class="btn ${hasRole ? 'btn-primary' : 'btn-secondary'}" 
                                    style="padding: 4px 12px; font-size: 12px; ${hasRole ? `background: ${role.color};` : ''}"
                                    onclick="toggleMemberRole('${serverId}', '${role._id}', '${member._id}', ${hasRole})">
                                ${hasRole ? '✓' : '+'} ${role.name}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
    
    showModal('Assign Roles to Members', `
        <div style="max-height: 400px; overflow-y: auto;">
            ${membersHtml || '<p style="color: #8b92a0;">No members found</p>'}
        </div>
    `);
}

async function toggleMemberRole(serverId, roleId, memberId, hasRole) {
    try {
        if (!hasRole) {
            // Add role
            await apiCall(`/servers/${serverId}/roles/${roleId}/members`, {
                method: 'POST',
                body: { userId: memberId }
            });
            showSuccess('Role assigned!');
        } else {
            showError('Role removal not yet implemented');
            return;
        }
        
        // Reload server data
        await loadUserData();
        closeModal();
        openAssignRolesModal(serverId);
    } catch (error) {
        showError('Failed to update role: ' + error.message);
    }
}

// Manage roles
async function openRolesModal(serverId) {
    const server = state.servers.find(s => s._id === serverId);
    if (!server) return;
    
    const rolesHtml = (server.roles || []).map(role => `
        <div class="role-item" style="border-left: 4px solid ${role.color}; padding: 12px; margin: 8px 0; 
                                       background: #2f3339; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: ${role.color}; font-weight: 600;">${role.name}</span>
                <span style="color: #8b92a0; font-size: 12px;">${role.members?.length || 0} members</span>
            </div>
        </div>
    `).join('');
    
    showModal('Manage Roles', `
        <div class="roles-modal">
            <div class="roles-list">
                ${rolesHtml || '<p style="color: #8b92a0;">No roles yet</p>'}
            </div>
            <div class="form-group" style="margin-top: 20px;">
                <label class="form-label">Create New Role</label>
                <input type="text" class="form-input" id="roleName" placeholder="Role name">
                <input type="color" id="roleColor" value="#4a9eff" 
                       style="width: 100%; height: 40px; margin-top: 8px; border-radius: 8px; border: none;">
            </div>
        </div>
    `, async () => {
        const name = document.getElementById('roleName').value.trim();
        const color = document.getElementById('roleColor').value;
        if (!name) {
            showError('Please enter a role name');
            return;
        }
        await createRole(serverId, name, color);
    }, 'Create Role');
}

async function createRole(serverId, name, color) {
    try {
        await apiCall(`/servers/${serverId}/roles`, {
            method: 'POST',
            body: { name, color }
        });
        await loadUserData();
        closeModal();
        showSuccess('Role created!');
    } catch (error) {
        showError('Failed to create role: ' + error.message);
    }
}

// ============================================
// AVATAR UPLOAD FUNCTIONS
// ============================================

function openSettingsModal() {
    showModal('User Settings', `
        <div class="settings-modal" style="padding: 8px 0;">
            <div class="form-group">
                <label class="form-label" style="color: #b5bac1; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; display: block;">Username</label>
                <input type="text" class="form-input" id="settingsUsername" 
                       value="${state.user.username}" placeholder="Your username"
                       style="background: #202225; border: 1px solid #202225; border-radius: 4px; padding: 10px; color: #dcddde; font-size: 16px; width: 100%;">
            </div>
            
            <div class="form-group">
                <label class="form-label" style="color: #b5bac1; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; display: block;">Bio</label>
                <textarea class="form-input" id="settingsBio" 
                          placeholder="Tell us about yourself..." 
                          maxlength="190" rows="3"
                          style="background: #202225; border: 1px solid #202225; border-radius: 4px; padding: 10px; color: #dcddde; font-size: 16px; width: 100%; resize: vertical; font-family: inherit;">${state.user.bio || ''}</textarea>
                <div style="color: #72767d; font-size: 12px; margin-top: 4px;">
                    <span id="bioCounter">${(state.user.bio || '').length}</span>/190 characters
                </div>
            </div>
            
            <div class="form-group">
                <label class="form-label" style="color: #b5bac1; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; display: block;">Avatar</label>
                <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 12px;">
                    <div class="avatar" style="width: 80px; height: 80px; font-size: 40px; border-radius: 50%;">
                        ${state.user.avatar && state.user.avatar.startsWith('data:') ? 
                            `<img src="${state.user.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">` :
                            `<span class="avatar-text">${state.user.avatar || '👤'}</span>`
                        }
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px; flex: 1;">
                        <button class="btn btn-secondary" onclick="openAvatarUpload()" 
                                style="background: #4e5058; color: white; border: none; padding: 10px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            📷 UPLOAD IMAGE
                        </button>
                        <button class="btn btn-secondary" onclick="openEmojiAvatarPicker()"
                                style="background: #4e5058; color: white; border: none; padding: 10px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            😀 CHOOSE EMOJI
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="form-group">
                <label class="form-label" style="color: #b5bac1; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; display: block;">Status</label>
                <select class="form-input" id="settingsStatus"
                        style="background: #202225; border: 1px solid #202225; border-radius: 4px; padding: 10px; color: #dcddde; font-size: 16px; width: 100%; cursor: pointer;">
                    <option value="online" ${state.user.status === 'online' ? 'selected' : ''}>🟢 Online</option>
                    <option value="idle" ${state.user.status === 'idle' ? 'selected' : ''}>🟡 Idle</option>
                    <option value="dnd" ${state.user.status === 'dnd' ? 'selected' : ''}>🔴 Do Not Disturb</option>
                    <option value="offline" ${state.user.status === 'offline' ? 'selected' : ''}>⚫ Offline</option>
                </select>
            </div>
        </div>
    `, async () => {
        await saveUserSettings();
    }, 'SAVE CHANGES');
    
    // Add bio counter
    setTimeout(() => {
        const bioInput = document.getElementById('settingsBio');
        const counter = document.getElementById('bioCounter');
        if (bioInput && counter) {
            bioInput.addEventListener('input', () => {
                counter.textContent = bioInput.value.length;
            });
        }
    }, 100);
}

function openAvatarUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Check file size (max 2MB)
        if (file.size > 2 * 1024 * 1024) {
            showError('Image too large! Max size is 2MB');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target.result;
            
            try {
                await apiCall('/me', {
                    method: 'PUT',
                    body: { avatar: base64 }
                });
                
                state.user.avatar = base64;
                closeModal();
                render();
                showSuccess('Avatar updated!');
            } catch (error) {
                showError('Failed to upload avatar: ' + error.message);
            }
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function openEmojiAvatarPicker() {
    const emojis = ['😀','😎','🤩','😍','🥳','😇','🤓','🧐','🤠','👻','🤖','👽','🦄','🐶','🐱','🐼','🦊','🦁','🐯','🐸','🐵','🦉','🦋','🌟','⭐','✨','💫','🔥','💎','👑','🎮','🎨','🎭','🎪','🎯','🚀','⚡','💻','📱','🎵','🎸','🏆','💪','🌈','🌙','☀️','🌍'];
    
    const emojisHtml = emojis.map(emoji => 
        `<button class="emoji-btn" onclick="setEmojiAvatar('${emoji}')" 
                style="font-size: 32px; padding: 12px; background: #2f3339; border: none; 
                       border-radius: 8px; cursor: pointer; transition: all 0.2s;"
                onmouseover="this.style.background='#3a3f47'" 
                onmouseout="this.style.background='#2f3339'">
            ${emoji}
        </button>`
    ).join('');
    
    showModal('Choose Emoji Avatar', `
        <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; max-height: 400px; overflow-y: auto;">
            ${emojisHtml}
        </div>
    `);
}

async function setEmojiAvatar(emoji) {
    try {
        await apiCall('/me', {
            method: 'PUT',
            body: { avatar: emoji }
        });
        
        state.user.avatar = emoji;
        closeModal();
        render();
        showSuccess('Avatar updated!');
    } catch (error) {
        showError('Failed to update avatar: ' + error.message);
    }
}

async function saveUserSettings() {
    const username = document.getElementById('settingsUsername').value.trim();
    const bio = document.getElementById('settingsBio').value.trim();
    const status = document.getElementById('settingsStatus').value;
    
    if (!username) {
        showError('Username cannot be empty');
        return;
    }
    
    try {
        const updatedUser = await apiCall('/me', {
            method: 'PUT',
            body: { username, bio, status }
        });
        
        state.user.username = username;
        state.user.bio = bio;
        state.user.status = status;
        
        closeModal();
        render();
        showSuccess('Settings saved!');
    } catch (error) {
        showError('Failed to save settings: ' + error.message);
    }
}

// ============================================
// IMPROVED CALL FUNCTIONS
// ============================================

async function startVoiceCall(friendId) {
    console.log('📞 Starting voice call with:', friendId);
    
    const friend = state.friends.find(f => f._id === friendId) || 
                   state.dms.find(d => d._id === state.activeDM)?.participants?.find(p => p._id === friendId);
    
    if (!friend) {
        showError('Friend not found');
        return;
    }
    
    showCallWindow(friend, 'voice', 'outgoing');
    
    // Emit call initiate to server
    if (socket && socket.connected) {
        socket.emit('call-initiate', {
            to: friendId,
            from: state.user.id,
            type: 'voice'
        });
    }
}

async function startVideoCall(friendId) {
    console.log('📹 Starting video call with:', friendId);
    
    const friend = state.friends.find(f => f._id === friendId) || 
                   state.dms.find(d => d._id === state.activeDM)?.participants?.find(p => p._id === friendId);
    
    if (!friend) {
        showError('Friend not found');
        return;
    }
    
    showCallWindow(friend, 'video', 'outgoing');
    
    // Emit call initiate to server
    if (socket && socket.connected) {
        socket.emit('call-initiate', {
            to: friendId,
            from: state.user.id,
            type: 'video'
        });
    }
}

function showCallWindow(friend, type, direction) {
    // Remove existing call window
    const existing = document.getElementById('callWindow');
    if (existing) existing.remove();
    
    const isVideo = type === 'video';
    const isOutgoing = direction === 'outgoing';
    
    const callWindow = document.createElement('div');
    callWindow.id = 'callWindow';
    callWindow.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 360px;
        background: #242831;
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        z-index: 9999;
        border: 1px solid #2f3339;
    `;
    
    callWindow.innerHTML = `
        <div style="text-align: center;">
            <div class="avatar" style="width: 80px; height: 80px; font-size: 40px; margin: 0 auto 16px;">
                ${friend.avatar && friend.avatar.startsWith('data:') ? 
                    `<img src="${friend.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">` :
                    `<span class="avatar-text">${friend.avatar || '👤'}</span>`
                }
            </div>
            <h3 style="color: #e4e6eb; margin-bottom: 8px;">${friend.username}</h3>
            <p style="color: #8b92a0; font-size: 14px; margin-bottom: 24px;">
                ${isOutgoing ? '📞 Calling...' : '📞 Incoming call...'}
            </p>
            
            ${isVideo ? `
                <div style="background: #1a1d23; border-radius: 12px; height: 200px; margin-bottom: 16px; 
                            display: flex; align-items: center; justify-content: center; color: #8b92a0;">
                    📹 Video ${isOutgoing ? 'connecting' : 'call'}...
                </div>
            ` : ''}
            
            <div style="display: flex; gap: 12px; justify-content: center;">
                ${!isOutgoing ? `
                    <button onclick="acceptCall()" style="width: 56px; height: 56px; border-radius: 50%; 
                            background: linear-gradient(135deg, #31c48d, #25a06e); border: none; 
                            color: white; font-size: 24px; cursor: pointer;">
                        📞
                    </button>
                ` : ''}
                <button onclick="toggleCallMute()" id="callMuteBtn" style="width: 48px; height: 48px; 
                        border-radius: 50%; background: #2f3339; border: none; color: #e4e6eb; 
                        font-size: 20px; cursor: pointer;">
                    🎤
                </button>
                ${isVideo ? `
                    <button onclick="toggleCallVideo()" id="callVideoBtn" style="width: 48px; height: 48px; 
                            border-radius: 50%; background: #2f3339; border: none; color: #e4e6eb; 
                            font-size: 20px; cursor: pointer;">
                        📹
                    </button>
                ` : ''}
                <button onclick="endCall()" style="width: 56px; height: 56px; border-radius: 50%; 
                        background: linear-gradient(135deg, #f87171, #dc2626); border: none; 
                        color: white; font-size: 24px; cursor: pointer;">
                    📵
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(callWindow);
    
    // Auto-close after 30 seconds if not answered
    if (isOutgoing) {
        setTimeout(() => {
            const window = document.getElementById('callWindow');
            if (window && window.querySelector('p').textContent.includes('Calling')) {
                endCall();
                showError('Call not answered');
            }
        }, 30000);
    }
}

function acceptCall() {
    const callWindow = document.getElementById('callWindow');
    if (callWindow) {
        const statusText = callWindow.querySelector('p');
        if (statusText) {
            statusText.textContent = '✅ Connected';
            statusText.style.color = '#31c48d';
        }
    }
    showSuccess('Call connected!');
}

function toggleCallMute() {
    const btn = document.getElementById('callMuteBtn');
    if (btn) {
        const isMuted = btn.textContent === '🔇';
        btn.textContent = isMuted ? '🎤' : '🔇';
        btn.style.background = isMuted ? '#2f3339' : '#f87171';
    }
}

function toggleCallVideo() {
    const btn = document.getElementById('callVideoBtn');
    if (btn) {
        const isOff = btn.textContent === '📹';
        btn.textContent = isOff ? '🚫' : '📹';
        btn.style.background = isOff ? '#f87171' : '#2f3339';
    }
}

function endCall() {
    const callWindow = document.getElementById('callWindow');
    if (callWindow) {
        callWindow.remove();
    }
    showSuccess('Call ended');
}

// Listen for incoming calls
if (socket) {
    socket.on('incoming-call', (data) => {
        console.log('📞 Incoming call from:', data.from);
        showCallWindow(data.from, data.type, 'incoming');
        
        // Show notification
        if (Notification.permission === 'granted') {
            new Notification('Incoming Call', {
                body: `${data.from.username} is calling you`,
                icon: data.from.avatar || '📞'
            });
        }
    });
}

console.log('✅ Server management and call functions loaded!');


// Join server by invite code
async function joinServerByInvite(code) {
    try {
        console.log('🔗 Joining server with invite code:', code);
        const server = await apiCall(`/invites/${code}/join`, {
            method: 'POST'
        });
        
        showSuccess(`Joined server: ${server.name}!`);
        
        // Reload user data to get new server
        await loadUserData();
        
        // Switch to new server
        state.activeServer = server._id;
        if (server.channels && server.channels.length > 0) {
            state.activeChannel = server.channels[0]._id;
        }
        state.view = 'home';
        render();
    } catch (error) {
        console.error('❌ Failed to join server:', error);
        showError('Failed to join server: ' + error.message);
    }
}
