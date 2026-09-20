const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

const roomUsers = {};
const roomStatuses = {};
let messageStore = [];
let saveQueue = Promise.resolve();

async function initStorage() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
        const raw = await fs.readFile(MESSAGES_FILE, 'utf8');
        messageStore = JSON.parse(raw);

        if (!Array.isArray(messageStore)) {
            messageStore = [];
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            messageStore = [];
            await saveMessages();
        } else {
            throw error;
        }
    }
}

function saveMessages() {
    // Prevent two simultaneous writes from corrupting the JSON file.
    saveQueue = saveQueue.then(async () => {
        const tempFile = MESSAGES_FILE + '.tmp';
        await fs.writeFile(tempFile, JSON.stringify(messageStore, null, 2), 'utf8');
        await fs.rename(tempFile, MESSAGES_FILE);
    }).catch(error => {
        console.error('خطا در ذخیره messages.json:', error);
    });

    return saveQueue;
}

function getRoomMessages(room) {
    return messageStore.filter(message => message.room === room);
}

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/room/:id', (req, res) => {
    const username = String(
        req.query.user || 'کاربر_' + Math.floor(Math.random() * 1000)
    ).trim().slice(0, 50);

    const roomId = String(req.params.id).trim().slice(0, 100);

    if (!roomId) return res.redirect('/');

    res.render('room', { roomId, username });
});

io.on('connection', (socket) => {
    socket.on('joinRoom', async ({ username, room }) => {
        username = String(username || 'کاربر').trim().slice(0, 50);
        room = String(room || 'room1').trim().slice(0, 100);

        socket.join(room);
        socket.username = username;
        socket.room = room;

        if (!roomUsers[room]) roomUsers[room] = [];
        if (!roomStatuses[room]) roomStatuses[room] = {};

        roomUsers[room].push({ id: socket.id, username });
        roomStatuses[room][socket.id] = {
            muted: false,
            deafened: false
        };

        io.to(room).emit('roomUsers', roomUsers[room]);
        io.to(room).emit('roomMediaState', {
            statuses: roomStatuses[room]
        });

        socket.broadcast.to(room).emit('user-joined', socket.id);

        const roomMessages = getRoomMessages(room);
        const messages = roomMessages.slice(-25);

        socket.emit('chatHistory', {
            messages,
            hasMore: roomMessages.length > messages.length
        });

        io.to(room).emit('chatMessage', {
            user: 'سیستم',
            text: `${username} وارد اتاق شد.`,
            type: 'system'
        });
    });

    socket.on('loadChatHistory', ({ room, beforeCreatedAt, limit = 25 }) => {
        if (room !== socket.room) return;

        limit = Math.min(Math.max(Number(limit) || 25, 1), 50);

        const roomMessages = getRoomMessages(room);

        const older = roomMessages
            .filter(message => new Date(message.created_at) < new Date(beforeCreatedAt));

        const messages = older.slice(Math.max(0, older.length - limit));

        socket.emit('chatHistoryPage', {
            messages,
            hasMore: older.length > messages.length
        });
    });

    socket.on('chatMessage', async (msg) => {
        if (!socket.room || !socket.username) return;

        msg = String(msg ?? '').trim();
        if (!msg || msg.length > 2000) return;

        const message = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2),
            room: socket.room,
            username: socket.username,
            text: msg,
            created_at: new Date().toISOString()
        };

        messageStore.push(message);

        // Keep the JSON file from growing forever.
        // Old messages can still be loaded, but cap the total stored records.
        if (messageStore.length > 50000) {
            messageStore = messageStore.slice(-50000);
        }

        await saveMessages();

        io.to(socket.room).emit('chatMessage', {
            user: socket.username,
            username: socket.username,
            text: msg,
            type: 'user',
            created_at: message.created_at,
            id: message.id
        });
    });

    socket.on('status-changed', (data = {}) => {
        if (!socket.room) return;

        const status = {
            muted: Boolean(data.muted),
            deafened: Boolean(data.deafened)
        };

        if (!roomStatuses[socket.room]) roomStatuses[socket.room] = {};

        roomStatuses[socket.room][socket.id] = status;

        io.to(socket.room).emit('user-status-changed', {
            userId: socket.id,
            ...status
        });
    });

    socket.on('screen-share-started', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('screen-share-started', data);
        }
    });

    socket.on('screen-share-stopped', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('screen-share-stopped', data);
        }
    });

    socket.on('webcam-enabled', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('webcam-enabled', data);
        }
    });

    socket.on('webcam-disabled', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('webcam-disabled', data);
        }
    });

    // WebRTC signaling
    socket.on('offer', payload => {
        if (payload?.target) {
            io.to(payload.target).emit('offer', payload);
        }
    });

    socket.on('answer', payload => {
        if (payload?.target) {
            io.to(payload.target).emit('answer', payload);
        }
    });

    socket.on('ice-candidate', incoming => {
        if (incoming?.target) {
            io.to(incoming.target).emit(
                'ice-candidate',
                incoming.candidate,
                socket.id
            );
        }
    });

    socket.on('disconnect', () => {
        const room = socket.room;
        if (!room) return;

        if (roomUsers[room]) {
            roomUsers[room] = roomUsers[room].filter(
                user => user.id !== socket.id
            );

            io.to(room).emit('roomUsers', roomUsers[room]);
            socket.broadcast.to(room).emit(
                'user-disconnected',
                socket.id
            );
        }

        if (roomStatuses[room]) {
            delete roomStatuses[room][socket.id];

            io.to(room).emit('roomMediaState', {
                statuses: roomStatuses[room]
            });
        }

        if (roomUsers[room]?.length === 0) {
            delete roomUsers[room];
            delete roomStatuses[room];
        }

        if (socket.username) {
            io.to(room).emit('chatMessage', {
                user: 'سیستم',
                text: `${socket.username} از اتاق خارج شد.`,
                type: 'system'
            });
        }
    });
});

const PORT = Number(process.env.PORT || 3002);

initStorage()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
            console.log(`JSON storage: ${MESSAGES_FILE}`);
        });
    })
    .catch(error => {
        console.error('خطا در راه‌اندازی storage:', error);
        process.exit(1);
    });
