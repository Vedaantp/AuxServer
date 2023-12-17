const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const activeServers = {};

app.use(cors({
    origin: ['auxapp://'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
}));
app.use(express.json());


app.get('/activeServers', (req, res) => {
    const numberOfServers = Object.keys(activeServers).length;
    res.json({ numberOfServers });
});

io.on('connection', (socket) => {
    socket.on('createServer', ({ username, userId }) => {
        const serverCode = generateUniqueCode();
        activeServers[serverCode] = { users: [], host: {} };
        activeServers[serverCode].host = { userId: userId, username: username };
        // activeServers[serverCode].users.push({ userId: userId, username: username, host: host });
        socket.join(serverCode);
        socket.emit('serverCreated', { serverCode });
        io.to(serverCode).emit('userJoined', { users: activeServers[serverCode].users, host: activeServers[serverCode].host });
    });

    socket.on('joinServer', ({ serverCode, username, userId }) => {
        const server = activeServers[serverCode];

        if (server) {
            if (server && server.users.length < 5) {
                server.users.push({ userId: userId, username: username });
                socket.join(serverCode);
                io.to(serverCode).emit('userJoined', { users: server.users, host: server.host });
            } else {
                socket.emit('serverFull');
            }
        } else {
            socket.emit("joinError", {message: "Join unsuccessfull."});
        }
    });

    socket.on('leaveServer', ({ serverCode, userId }) => {
        const server = activeServers[serverCode];
    
        if (server) {

            if (server.host.userId === userId) {
                io.to(serverCode).emit('hostLeft', {message: `Host left. ${serverCode} has closed.`});
                delete activeServers[serverCode];
            } else {
                server.users = server.users.filter((user) => user.userId !== userId);
                io.to(serverCode).emit('userLeft', { users: server.users, host: server.host });
            }

        } else {
            io.emit('leaveError', {message: "Could not leave server successfully."});
        }
    });

    socket.on('getUsers', ({ serverCode }) => {
        const server = activeServers[serverCode];
        if (server) {
            io.to(socket.id).emit('userList', { users: server.users });
        }
    });

    socket.on('start', ({ serverCode, userId }) => {
        const server = activeServers[serverCode];

        if (server && server.host.userId === userId) {
            // Start the timer sequence
            startTimerSequence(serverCode);
        }
    });
});

function generateUniqueCode() {
    const code = Math.floor(100000 + Math.random() * 900000);
    return code.toString();
}

function startTimerSequence(serverCode) {
    const timers = [
        { event: 'votingPhase', duration: 15000 },
        { event: 'searchingPhase', duration: 15000 },
        // Add more phases if needed
    ];

    function runTimer(index) {
        if (index < timers.length) {
            const { event, duration } = timers[index];

            io.to(serverCode).emit(event);

            setTimeout(() => {
                runTimer(index + 1);
            }, duration);
        }
    }

    // Start the timer sequence
    runTimer(0);
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});