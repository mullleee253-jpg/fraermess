const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Config
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:uLtRvqqzWMJRsjlPuYvkRTQWXiVlGQmr@mongodb.railway.internal:27017';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.set('trust proxy', 1); // Trust Railway proxy
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true
});
app.use('/api/', limiter);

// MongoDB Connection
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Schemas
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String, default: '👤' },
    status: { type: String, default: 'online', enum: ['online', 'idle', 'dnd', 'offline'] },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now }
});

const serverSchema = new mongoose.Schema({
    name: { type: String, required: true },
    icon: { type: String, default: '🏠' },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    channels: [{
        name: { type: String, required: true },
        type: { type: String, enum: ['text', 'voice'], default: 'text' }
    }],
    roles: [{
        name: { type: String, required: true },
        color: { type: String, default: '#99aab5' },
        permissions: { type: Number, default: 0 },
        members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
    }],
    invites: [{
        code: { type: String, required: true, unique: true },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        expiresAt: { type: Date },
        maxUses: { type: Number, default: 0 },
        uses: { type: Number, default: 0 }
    }],
    createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    server: { type: mongoose.Schema.Types.ObjectId, ref: 'Server' },
    channel: { type: String },
    timestamp: { type: Date, default: Date.now }
});

const friendRequestSchema = new mongoose.Schema({
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

const dmSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    messages: [{
        content: { type: String, required: true },
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false }, // ИСПРАВЛЕНО: не обязательно для старых сообщений
        timestamp: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});

// Create unique compound index for DM participants
dmSchema.index({ participants: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
const Server = mongoose.model('Server', serverSchema);
const Message = mongoose.model('Message', messageSchema);
const FriendRequest = mongoose.model('FriendRequest', friendRequestSchema);
const DM = mongoose.model('DM', dmSchema);

// Auth Middleware
const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) throw new Error();
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) throw new Error();
        req.user = user;
        req.userId = user._id;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Please authenticate' });
    }
};

// Auth Routes
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, email, password: hashedPassword });
        await user.save();
        const token = jwt.sign({ userId: user._id }, JWT_SECRET);
        res.json({ token, user: { id: user._id, username: user.username, email: user.email, avatar: user.avatar, status: user.status } });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user._id }, JWT_SECRET);
        res.json({ token, user: { id: user._id, username: user.username, email: user.email, avatar: user.avatar, status: user.status } });
    } catch (error) {
        res.status(400).json({ error: 'Login failed' });
    }
});

app.get('/api/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).populate('friends', 'username avatar status');
        res.json({ id: user._id, username: user.username, email: user.email, avatar: user.avatar, status: user.status, friends: user.friends });
    } catch (error) {
        res.status(400).json({ error: 'Failed to fetch user' });
    }
});

app.put('/api/me', auth, async (req, res) => {
    try {
        const { username, avatar, status } = req.body;
        const updateData = {};
        if (username) updateData.username = username;
        if (avatar) updateData.avatar = avatar; // base64 или emoji
        if (status) updateData.status = status;
        
        const user = await User.findByIdAndUpdate(req.userId, updateData, { new: true });
        res.json({ id: user._id, username: user.username, email: user.email, avatar: user.avatar, status: user.status });
    } catch (error) {
        res.status(400).json({ error: 'Failed to update user' });
    }
});

// Server Routes
app.get('/api/servers', auth, async (req, res) => {
    try {
        const servers = await Server.find({ members: req.userId }).populate('members', 'username avatar status');
        res.json(servers);
    } catch (error) {
        res.status(400).json({ error: 'Failed to fetch servers' });
    }
});

app.post('/api/servers', auth, async (req, res) => {
    try {
        const { name, icon } = req.body;
        const server = new Server({
            name,
            icon: icon || '🏠',
            owner: req.userId,
            members: [req.userId],
            channels: [{ name: 'general', type: 'text' }]
        });
        await server.save();
        await server.populate('members', 'username avatar status');
        res.json(server);
    } catch (error) {
        res.status(400).json({ error: 'Failed to create server' });
    }
});

app.get('/api/servers/:serverId', auth, async (req, res) => {
    try {
        const server = await Server.findById(req.params.serverId).populate('members', 'username avatar status');
        if (!server || !server.members.some(m => m._id.toString() === req.userId.toString())) {
            return res.status(404).json({ error: 'Server not found' });
        }
        res.json(server);
    } catch (error) {
        res.status(400).json({ error: 'Failed to fetch server' });
    }
});

// Channel Routes
app.post('/api/servers/:serverId/channels', auth, async (req, res) => {
    try {
        const { name, type } = req.body;
        const server = await Server.findById(req.params.serverId);
        if (!server || !server.members.includes(req.userId)) {
            return res.status(404).json({ error: 'Server not found' });
        }
        server.channels.push({ name, type: type || 'text' });
        await server.save();
        res.json(server);
    } catch (error) {
        res.status(400).json({ error: 'Failed to create channel' });
    }
});

// Role Routes
app.post('/api/servers/:serverId/roles', auth, async (req, res) => {
    try {
        const { name, color } = req.body;
        const server = await Server.findById(req.params.serverId);
        if (!server || server.owner.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Only owner can create roles' });
        }
        server.roles.push({ name, color: color || '#99aab5', members: [] });
        await server.save();
        res.json(server);
    } catch (error) {
        res.status(400).json({ error: 'Failed to create role' });
    }
});

app.post('/api/servers/:serverId/roles/:roleId/members', auth, async (req, res) => {
    try {
        const { userId } = req.body;
        const server = await Server.findById(req.params.serverId);
        if (!server || server.owner.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Only owner can assign roles' });
        }
        const role = server.roles.id(req.params.roleId);
        if (!role) return res.status(404).json({ error: 'Role not found' });
        if (!role.members.includes(userId)) {
            role.members.push(userId);
            await server.save();
        }
        res.json(server);
    } catch (error) {
        res.status(400).json({ error: 'Failed to assign role' });
    }
});

// Invite Routes
app.post('/api/servers/:serverId/invites', auth, async (req, res) => {
    try {
        const server = await Server.findById(req.params.serverId);
        if (!server || !server.members.includes(req.userId)) {
            return res.status(404).json({ error: 'Server not found' });
        }
        const code = Math.random().toString(36).substring(2, 10);
        server.invites.push({
            code,
            createdBy: req.userId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });
        await server.save();
        res.json({ code, url: `${req.protocol}://${req.get('host')}/invite/${code}` });
    } catch (error) {
        res.status(400).json({ error: 'Failed to create invite' });
    }
});

app.post('/api/invites/:code/join', auth, async (req, res) => {
    try {
        const server = await Server.findOne({ 'invites.code': req.params.code });
        if (!server) return res.status(404).json({ error: 'Invalid invite' });
        
        const invite = server.invites.find(i => i.code === req.params.code);
        if (invite.expiresAt && invite.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Invite expired' });
        }
        if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
            return res.status(400).json({ error: 'Invite max uses reached' });
        }
        
        if (!server.members.includes(req.userId)) {
            server.members.push(req.userId);
            invite.uses += 1;
            await server.save();
        }
        
        await server.populate('members', 'username avatar status');
        res.json(server);
    } catch (error) {
        res.status(400).json({ error: 'Failed to join server' });
    }
});

// Message Routes
app.get('/api/servers/:serverId/channels/:channelId/messages', auth, async (req, res) => {
    try {
        const messages = await Message.find({
            server: req.params.serverId,
            channel: req.params.channelId
        }).populate('author', 'username avatar').sort({ timestamp: 1 }).limit(100);
        res.json(messages);
    } catch (error) {
        res.status(400).json({ error: 'Failed to fetch messages' });
    }
});

// Friend Routes
app.post('/api/friends/request', auth, async (req, res) => {
    try {
        const { username } = req.body;
        const targetUser = await User.findOne({ username });
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (targetUser._id.toString() === req.userId.toString()) {
            return res.status(400).json({ error: 'Cannot add yourself' });
        }
        
        const existingRequest = await FriendRequest.findOne({
            $or: [
                { from: req.userId, to: targetUser._id },
                { from: targetUser._id, to: req.userId }
            ]
        });
        
        if (existingRequest) return res.status(400).json({ error: 'Request already exists' });
        
        const friendRequest = new FriendRequest({ from: req.userId, to: targetUser._id });
        await friendRequest.save();
        
        const populatedRequest = await FriendRequest.findById(friendRequest._id).populate('from', 'username avatar');
        
        // Emit to target user
        const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === targetUser._id.toString());
        if (targetSocket) {
            targetSocket.emit('friend-request', populatedRequest);
        }
        
        res.json(populatedRequest);
    } catch (error) {
        res.status(400).json({ error: 'Failed to send friend request' });
    }
});

app.get('/api/friends/requests', auth, async (req, res) => {
    try {
        const requests = await FriendRequest.find({ to: req.userId, status: 'pending' }).populate('from', 'username avatar');
        res.json(requests);
    } catch (error) {
        res.status(400).json({ error: 'Failed to fetch friend requests' });
    }
});

app.post('/api/friends/accept', auth, async (req, res) => {
    try {
        const { requestId } = req.body;
        const friendRequest = await FriendRequest.findById(requestId);
        if (!friendRequest || friendRequest.to.toString() !== req.userId.toString()) {
            return res.status(404).json({ error: 'Request not found' });
        }
        
        friendRequest.status = 'accepted';
        await friendRequest.save();
        
        await User.findByIdAndUpdate(req.userId, { $addToSet: { friends: friendRequest.from } });
        await User.findByIdAndUpdate(friendRequest.from, { $addToSet: { friends: req.userId } });
        
        // Emit to both users
        const fromSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === friendRequest.from.toString());
        if (fromSocket) {
            fromSocket.emit('friend-accepted', { userId: req.userId });
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: 'Failed to accept friend request' });
    }
});

// DM Routes
app.get('/api/dms', auth, async (req, res) => {
    try {
        const dms = await DM.find({ participants: req.userId })
            .populate('participants', 'username avatar status')
            .sort({ createdAt: -1 });
        
        // Populate message authors and filter out messages without author
        for (let dm of dms) {
            const validMessages = [];
            for (let msg of dm.messages) {
                if (msg.author) {
                    const author = await User.findById(msg.author).select('username avatar');
                    if (author) {
                        msg.author = author;
                        validMessages.push(msg);
                    }
                }
            }
            dm.messages = validMessages;
        }
        
        res.json(dms);
    } catch (error) {
        console.error('❌ Error loading DMs:', error);
        res.status(400).json({ error: 'Failed to fetch DMs' });
    }
});

app.post('/api/dms', auth, async (req, res) => {
    try {
        const { userId } = req.body;
        
        // Check if DM already exists
        const existingDM = await DM.findOne({
            participants: { $all: [req.userId, userId] }
        }).populate('participants', 'username avatar status');
        
        if (existingDM) {
            // Populate message authors and filter out messages without author
            const validMessages = [];
            for (let msg of existingDM.messages) {
                if (msg.author) {
                    const author = await User.findById(msg.author).select('username avatar');
                    if (author) {
                        msg.author = author;
                        validMessages.push(msg);
                    }
                }
            }
            existingDM.messages = validMessages;
            return res.json(existingDM);
        }
        
        const dm = new DM({ participants: [req.userId, userId] });
        await dm.save();
        await dm.populate('participants', 'username avatar status');
        res.json(dm);
    } catch (error) {
        console.error('❌ Error creating DM:', error);
        res.status(400).json({ error: 'Failed to create DM' });
    }
});

// Invite page route - redirect to main page with invite code
app.get('/invite/:code', (req, res) => {
    res.redirect(`/?invite=${req.params.code}`);
});

// Socket.io - ИСПРАВЛЕНО ДЛЯ REAL-TIME
io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);
    
    socket.on('join', async (data) => {
        socket.userId = data.userId;
        console.log(`👤 User ${data.userId} joining servers...`);
        console.log(`✅ socket.userId SET TO: ${socket.userId}`);
        
        if (data.servers && Array.isArray(data.servers)) {
            data.servers.forEach(serverId => {
                socket.join(`server-${serverId}`);
                console.log(`📡 User joined server room: server-${serverId}`);
            });
        }
        
        // Join user's personal room for DMs
        socket.join(`user-${data.userId}`);
        console.log(`✅ User ${data.userId} fully connected to ${data.servers?.length || 0} servers`);
        
        // Send confirmation back to client
        socket.emit('join-success', {
            userId: data.userId,
            servers: data.servers || []
        });
    });
    
    // REAL-TIME MESSAGES - ИСПРАВЛЕНО
    socket.on('message', async (data) => {
        try {
            const { serverId, channelId, content } = data;
            console.log(`📨 New message in ${serverId}/${channelId}:`, content);
            console.log(`👤 Author userId:`, socket.userId);
            
            if (!socket.userId) {
                console.error('❌ socket.userId is not set!');
                socket.emit('error', { message: 'User not authenticated' });
                return;
            }
            
            if (!serverId || !channelId || !content) {
                console.error('❌ Invalid message data:', { serverId, channelId, content });
                return;
            }
            
            // Create message
            const message = new Message({
                content,
                author: socket.userId,
                server: serverId,
                channel: channelId
            });
            
            console.log('💾 Saving message to DB...');
            await message.save();
            console.log('✅ Message saved to DB with ID:', message._id);
            
            // Populate author AFTER saving
            await message.populate('author', 'username avatar');
            console.log(`✅ Message populated, author:`, message.author?.username || 'NULL');
            
            if (!message.author) {
                console.error('❌ CRITICAL: Author not found for userId:', socket.userId);
            }
            
            // Create message object to send
            const messageToSend = {
                _id: message._id,
                content: message.content,
                timestamp: message.timestamp,
                author: message.author ? {
                    _id: message.author._id,
                    username: message.author.username,
                    avatar: message.author.avatar
                } : null
            };
            
            console.log('📤 Sending message to clients:', messageToSend);
            
            // Emit to ALL users in the server room
            const roomName = `server-${serverId}`;
            console.log(`📡 Broadcasting to room: ${roomName}`);
            
            io.to(roomName).emit('message', {
                serverId,
                channelId,
                message: messageToSend
            });
            
            console.log(`✅ Message broadcasted successfully`);
            
        } catch (error) {
            console.error('❌ Message error:', error);
            console.error('Error stack:', error.stack);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });
    
    // REAL-TIME DM MESSAGES - ИСПРАВЛЕНО
    socket.on('dm-message', async (data) => {
        try {
            const { dmId, content } = data;
            console.log(`💬 New DM message in ${dmId}:`, content);
            console.log(`👤 Author userId:`, socket.userId);
            
            if (!socket.userId) {
                console.error('❌ socket.userId is not set!');
                socket.emit('error', { message: 'User not authenticated' });
                return;
            }
            
            if (!dmId || !content) {
                console.error('❌ Invalid DM data:', { dmId, content });
                return;
            }
            
            const dm = await DM.findById(dmId);
            if (!dm) {
                console.error('❌ DM not found:', dmId);
                return;
            }
            
            // Check if user is participant
            if (!dm.participants.includes(socket.userId)) {
                console.error('❌ User not participant in DM');
                return;
            }
            
            const newMessage = {
                content,
                author: socket.userId,
                timestamp: new Date()
            };
            
            dm.messages.push(newMessage);
            console.log('💾 Saving DM message to DB...');
            await dm.save();
            console.log('✅ DM message saved to DB');
            
            // Get the full message with populated author
            const author = await User.findById(socket.userId).select('username avatar');
            console.log(`✅ DM author found:`, author?.username || 'NULL');
            
            if (!author) {
                console.error('❌ CRITICAL: Author not found for userId:', socket.userId);
            }
            
            const populatedMessage = {
                _id: newMessage._id || new Date().getTime(),
                content: newMessage.content,
                timestamp: newMessage.timestamp,
                author: author ? {
                    _id: author._id,
                    username: author.username,
                    avatar: author.avatar
                } : null
            };
            
            console.log('📤 Sending DM message to clients:', populatedMessage);
            
            // Emit to BOTH participants
            dm.participants.forEach(participantId => {
                const roomName = `user-${participantId}`;
                console.log(`📡 Sending DM to room: ${roomName}`);
                
                io.to(roomName).emit('dm-message', {
                    dmId,
                    message: populatedMessage
                });
            });
            
            console.log(`✅ DM message sent to all participants`);
            
        } catch (error) {
            console.error('❌ DM message error:', error);
            console.error('Error stack:', error.stack);
            socket.emit('error', { message: 'Failed to send DM' });
        }
    });
    
    // Call handling
    socket.on('call-initiate', async (data) => {
        try {
            const { to, type, from } = data;
            const caller = await User.findById(from).select('username avatar');
            const targetSocket = Array.from(io.sockets.sockets.values())
                .find(s => s.userId === to);
            
            if (targetSocket) {
                targetSocket.emit('incoming-call', {
                    from: caller,
                    type,
                    callId: socket.id
                });
            }
        } catch (error) {
            console.error('Call initiate error:', error);
        }
    });
    
    socket.on('call-accept', (data) => {
        const { to } = data;
        const targetSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === to);
        
        if (targetSocket) {
            targetSocket.emit('call-accepted', { from: socket.userId });
        }
    });
    
    socket.on('call-decline', (data) => {
        const { to } = data;
        const targetSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === to);
        
        if (targetSocket) {
            targetSocket.emit('call-declined', { from: socket.userId });
        }
    });
    
    socket.on('call-offer', (data) => {
        const { to, offer } = data;
        const targetSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === to);
        
        if (targetSocket) {
            targetSocket.emit('call-offer', { offer, from: socket.userId });
        }
    });
    
    socket.on('call-answer', (data) => {
        const { to, answer } = data;
        const targetSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === to);
        
        if (targetSocket) {
            targetSocket.emit('call-answer', { answer, from: socket.userId });
        }
    });
    
    socket.on('ice-candidate', (data) => {
        const { to, candidate } = data;
        const targetSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === to);
        
        if (targetSocket) {
            targetSocket.emit('ice-candidate', { candidate, from: socket.userId });
        }
    });
    
    socket.on('call-end', (data) => {
        const { to } = data;
        const targetSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === to);
        
        if (targetSocket) {
            targetSocket.emit('call-ended', { from: socket.userId });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('🚪 User disconnected:', socket.id);
    });
    
    // Test handler for debugging
    socket.on('test', (data) => {
        console.log('🧪 Test message received:', data);
        socket.emit('test-response', { message: 'Hello from server!', timestamp: new Date() });
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, closing server gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        mongoose.connection.close(false, () => {
            console.log('✅ MongoDB connection closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('👋 SIGINT received, closing server gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        mongoose.connection.close(false, () => {
            console.log('✅ MongoDB connection closed');
            process.exit(0);
        });
    });
});
