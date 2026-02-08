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
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

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
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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
        const user = await User.findByIdAndUpdate(req.userId, { username, avatar, status }, { new: true });
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
        
        // Populate message authors
        for (let dm of dms) {
            for (let msg of dm.messages) {
                const author = await User.findById(msg.author).select('username avatar');
                msg.author = author;
            }
        }
        
        res.json(dms);
    } catch (error) {
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
            // Populate message authors
            for (let msg of existingDM.messages) {
                const author = await User.findById(msg.author).select('username avatar');
                msg.author = author;
            }
            return res.json(existingDM);
        }
        
        const dm = new DM({ participants: [req.userId, userId] });
        await dm.save();
        await dm.populate('participants', 'username avatar status');
        res.json(dm);
    } catch (error) {
        res.status(400).json({ error: 'Failed to create DM' });
    }
});

// Socket.io - ИСПРАВЛЕНО ДЛЯ REAL-TIME
io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);
    
    socket.on('join', async (data) => {
        socket.userId = data.userId;
        console.log(`👤 User ${data.userId} joining servers...`);
        
        if (data.servers && Array.isArray(data.servers)) {
            data.servers.forEach(serverId => {
                socket.join(`server-${serverId}`);
                console.log(`📡 User joined server room: server-${serverId}`);
            });
        }
        
        // Join user's personal room for DMs
        socket.join(`user-${data.userId}`);
        console.log(`✅ User ${data.userId} fully connected`);
    });
    
    // REAL-TIME MESSAGES - ИСПРАВЛЕНО
    socket.on('message', async (data) => {
        try {
            const { serverId, channelId, content } = data;
            console.log(`📨 New message in ${serverId}/${channelId}:`, content);
            
            if (!socket.userId || !serverId || !channelId || !content) {
                console.error('❌ Invalid message data');
                return;
            }
            
            const message = new Message({
                content,
                author: socket.userId,
                server: serverId,
                channel: channelId
            });
            
            await message.save();
            await message.populate('author', 'username avatar');
            
            console.log(`✅ Message saved and populated:`, message.author.username);
            
            // Emit to ALL users in the server room
            const roomName = `server-${serverId}`;
            console.log(`📡 Broadcasting to room: ${roomName}`);
            
            io.to(roomName).emit('message', {
                serverId,
                channelId,
                message: {
                    _id: message._id,
                    content: message.content,
                    author: {
                        _id: message.author._id,
                        username: message.author.username,
                        avatar: message.author.avatar
                    },
                    timestamp: message.timestamp
                }
            });
            
            console.log(`✅ Message broadcasted to ${roomName}`);
            
        } catch (error) {
            console.error('❌ Message error:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });
    
    // REAL-TIME DM MESSAGES - ИСПРАВЛЕНО
    socket.on('dm-message', async (data) => {
        try {
            const { dmId, content } = data;
            console.log(`💬 New DM message in ${dmId}:`, content);
            
            if (!socket.userId || !dmId || !content) {
                console.error('❌ Invalid DM data');
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
            await dm.save();
            
            // Get the full message with populated author
            const author = await User.findById(socket.userId).select('username avatar');
            const populatedMessage = {
                _id: newMessage._id || new Date().getTime(),
                content: newMessage.content,
                author: {
                    _id: author._id,
                    username: author.username,
                    avatar: author.avatar
                },
                timestamp: newMessage.timestamp
            };
            
            console.log(`✅ DM message saved, author:`, author.username);
            
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
        console.log('User disconnected:', socket.id);
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
