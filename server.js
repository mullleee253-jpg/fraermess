const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/discord-clone';
mongoose.connect(MONGODB_URI);

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String, default: '👤' },
    status: { type: String, default: 'online' },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    friendRequests: [{
        from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        status: { type: String, default: 'pending' }
    }],
    servers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Server' }],
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Server Schema
const serverSchema = new mongoose.Schema({
    name: { type: String, required: true },
    icon: { type: String, default: '🏠' },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    channels: [{
        name: { type: String, required: true },
        type: { type: String, enum: ['text', 'voice'], default: 'text' },
        messages: [{
            author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            content: String,
            timestamp: { type: Date, default: Date.now }
        }]
    }],
    createdAt: { type: Date, default: Date.now }
});

const Server = mongoose.model('Server', serverSchema);

// Message Schema
const messageSchema = new mongoose.Schema({
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    channel: String,
    server: { type: mongoose.Schema.Types.ObjectId, ref: 'Server' },
    timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// DM Schema
const dmSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    messages: [{
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        content: String,
        timestamp: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});

const DM = mongoose.model('DM', dmSchema);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Auth middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.sendStatus(401);
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Routes

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ 
            $or: [{ email }, { username }] 
        });
        
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Create user
        const user = new User({
            username,
            email,
            password: hashedPassword
        });

        await user.save();

        // Generate token
        const token = jwt.sign({ userId: user._id }, JWT_SECRET);

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                status: user.status
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Generate token
        const token = jwt.sign({ userId: user._id }, JWT_SECRET);

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                status: user.status
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user profile
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId)
            .populate('friends', 'username avatar status')
            .populate('servers');
        
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update profile
app.put('/api/me', authenticateToken, async (req, res) => {
    try {
        const { username, avatar, status } = req.body;
        
        const user = await User.findByIdAndUpdate(
            req.user.userId,
            { username, avatar, status },
            { new: true }
        );
        
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send friend request
app.post('/api/friends/request', authenticateToken, async (req, res) => {
    try {
        const { username } = req.body;
        
        const targetUser = await User.findOne({ username });
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (targetUser._id.toString() === req.user.userId) {
            return res.status(400).json({ error: 'Cannot add yourself' });
        }
        
        // Check if already friends
        if (targetUser.friends.includes(req.user.userId)) {
            return res.status(400).json({ error: 'Already friends' });
        }
        
        // Check if request already sent
        const existingRequest = targetUser.friendRequests.find(
            r => r.from.toString() === req.user.userId
        );
        
        if (existingRequest) {
            return res.status(400).json({ error: 'Request already sent' });
        }
        
        // Add friend request
        targetUser.friendRequests.push({
            from: req.user.userId,
            status: 'pending'
        });
        
        await targetUser.save();
        
        res.json({ message: 'Friend request sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Accept friend request
app.post('/api/friends/accept', authenticateToken, async (req, res) => {
    try {
        const { requestId } = req.body;
        
        const user = await User.findById(req.user.userId);
        const requestIndex = user.friendRequests.findIndex(r => r._id.toString() === requestId);
        
        if (requestIndex === -1) {
            return res.status(404).json({ error: 'Request not found' });
        }
        
        const request = user.friendRequests[requestIndex];
        
        // Add to friends
        user.friends.push(request.from);
        
        const friend = await User.findById(request.from);
        friend.friends.push(req.user.userId);
        
        // Remove request
        user.friendRequests.splice(requestIndex, 1);
        
        await user.save();
        await friend.save();
        
        res.json({ message: 'Friend request accepted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get friend requests
app.get('/api/friends/requests', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId)
            .populate('friendRequests.from', 'username avatar');
        
        res.json(user.friendRequests);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create server
app.post('/api/servers', authenticateToken, async (req, res) => {
    try {
        const { name, icon } = req.body;
        
        const server = new Server({
            name,
            icon: icon || '🏠',
            owner: req.user.userId,
            members: [req.user.userId],
            channels: [{
                name: 'general',
                type: 'text'
            }]
        });
        
        await server.save();
        
        res.json(server);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user servers
app.get('/api/servers', authenticateToken, async (req, res) => {
    try {
        const servers = await Server.find({ 
            members: req.user.userId 
        }).populate('members', 'username avatar status');
        res.json(servers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get server details
app.get('/api/servers/:id', authenticateToken, async (req, res) => {
    try {
        const server = await Server.findById(req.params.id)
            .populate('members', 'username avatar status');
        
        if (!server.members.some(member => member._id.toString() === req.user.userId)) {
            return res.status(403).json({ error: 'Not a member' });
        }
        
        res.json(server);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create channel
app.post('/api/servers/:id/channels', authenticateToken, async (req, res) => {
    try {
        const { name, type } = req.body;
        
        const server = await Server.findById(req.params.id);
        
        if (server.owner.toString() !== req.user.userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        
        server.channels.push({ name, type: type || 'text' });
        await server.save();
        
        res.json(server);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get messages
app.get('/api/servers/:serverId/channels/:channelId/messages', authenticateToken, async (req, res) => {
    try {
        const server = await Server.findById(req.params.serverId);
        const channel = server.channels.id(req.params.channelId);
        
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        const populatedMessages = await Server.populate(server, {
            path: 'channels.messages.author',
            select: 'username avatar'
        });
        
        const targetChannel = populatedMessages.channels.id(req.params.channelId);
        res.json(targetChannel.messages);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get DMs
app.get('/api/dms', authenticateToken, async (req, res) => {
    try {
        const dms = await DM.find({
            participants: req.user.userId
        }).populate('participants', 'username avatar status');
        
        res.json(dms);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create or get DM
app.post('/api/dms', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.body;
        
        // Check if DM already exists
        let dm = await DM.findOne({
            participants: { $all: [req.user.userId, userId] }
        }).populate('participants', 'username avatar status');
        
        if (!dm) {
            dm = new DM({
                participants: [req.user.userId, userId]
            });
            await dm.save();
            await dm.populate('participants', 'username avatar status');
        }
        
        res.json(dm);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Join user to their rooms
    socket.on('join', (data) => {
        const { userId, servers } = data;
        socket.userId = userId;
        
        // Join user room
        socket.join(`user:${userId}`);
        
        // Join server rooms
        servers.forEach(serverId => {
            socket.join(`server:${serverId}`);
        });
    });
    
    // Handle messages
    socket.on('message', async (data) => {
        try {
            const { serverId, channelId, content } = data;
            
            // Save message to database
            const server = await Server.findById(serverId);
            const channel = server.channels.id(channelId);
            
            const messageData = {
                author: socket.userId,
                content,
                timestamp: new Date()
            };
            
            channel.messages.push(messageData);
            await server.save();
            
            // Populate author info
            await Server.populate(server, {
                path: 'channels.messages.author',
                select: 'username avatar'
            });
            
            const savedMessage = server.channels.id(channelId).messages.slice(-1)[0];
            
            // Broadcast to server members
            io.to(`server:${serverId}`).emit('message', {
                serverId,
                channelId,
                message: savedMessage
            });
        } catch (error) {
            console.error('Message error:', error);
        }
    });
    
    // Handle DM messages
    socket.on('dm-message', async (data) => {
        try {
            const { dmId, content } = data;
            
            const dm = await DM.findById(dmId);
            
            const messageData = {
                author: socket.userId,
                content,
                timestamp: new Date()
            };
            
            dm.messages.push(messageData);
            await dm.save();
            
            // Populate author info
            await DM.populate(dm, {
                path: 'messages.author',
                select: 'username avatar'
            });
            
            const savedMessage = dm.messages.slice(-1)[0];
            
            // Send to both participants
            dm.participants.forEach(participantId => {
                io.to(`user:${participantId}`).emit('dm-message', {
                    dmId,
                    message: savedMessage
                });
            });
        } catch (error) {
            console.error('DM message error:', error);
        }
    });
    
    // Handle typing
    socket.on('typing', (data) => {
        socket.to(`server:${data.serverId}`).emit('typing', {
            userId: socket.userId,
            channelId: data.channelId,
            typing: data.typing
        });
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});