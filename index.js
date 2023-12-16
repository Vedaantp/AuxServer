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
    socket.on('createServer', ({ username, userId, host }) => {
        const serverCode = generateUniqueCode();
        activeServers[serverCode] = { users: [] };
        activeServers[serverCode].users.push({ id: userId, username: username, host: host });
        socket.join(serverCode);
        socket.emit('serverCreated', { serverCode });
        io.to(serverCode).emit('userJoined', {users: activeServers[serverCode].users});
    });

    socket.on('joinServer', ({ serverCode, username, userId, host }) => {
        const server = activeServers[serverCode];

        if (server && server.users.length < 5) {
            server.users.push({ id: userId, username: username, host: host });
            socket.join(serverCode);
            io.to(serverCode).emit('userJoined', { users: server.users });
        } else {
            socket.emit('serverFull');
        }
    });

    socket.on('leaveServer', ({ serverCode, userId }) => {
        const server = activeServers[serverCode];
    
        if (server) {
            const hostIndex = server.users.findIndex(user => user.id === userId && user.host);
            if (hostIndex !== -1) {
                // The user leaving is the host
                io.to(serverCode).emit('hostLeft', {message: `Host left. ${serverCode} has closed.`});
                delete activeServers[serverCode];
            } else {
                // The user leaving is not the host
                server.users = server.users.filter((user) => user.id !== userId);
                io.to(serverCode).emit('userLeft', { users: server.users });
                if (server.users.length === 0) {
                    delete activeServers[serverCode];
                }
            }
        }
    });

    socket.on('getUsers', ({ serverCode }) => {
        const server = activeServers[serverCode];
        if (server) {
            io.to(socket.id).emit('userList', { users: server.users });
        }
    });
});

function generateUniqueCode() {
    const code = Math.floor(100000 + Math.random() * 900000);
    return code.toString();
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});