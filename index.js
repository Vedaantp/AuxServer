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
        activeServers[serverCode] = { users: [], host: {}, timer: null, startTimer: false };
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
            socket.emit("joinError", { message: "Join unsuccessfull." });
        }
    });

    socket.on('leaveServer', ({ serverCode, userId }) => {
        const server = activeServers[serverCode];

        if (server) {

            if (server.host.userId === userId) {
                io.to(serverCode).emit('hostLeft', { message: `Host left. ${serverCode} has closed.` });
                delete activeServers[serverCode];
            } else {
                server.users = server.users.filter((user) => user.userId !== userId);
                io.to(serverCode).emit('userLeft', { users: server.users, host: server.host });
            }

        } else {
            io.emit('leaveError', { message: "Could not leave server successfully." });
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
            server.startTimer = true;
            startTimerCycle(serverCode);
        }
    });

    socket.on('end', ({ serverCode, userId }) => {
        const server = activeServers[serverCode];

        if (server && server.host.userId === userId) {
            // Start the timer sequence
            server.startTimer = false;
            stopTimerCycle(serverCode);
        }

    });
});

function generateUniqueCode() {
    const code = Math.floor(100000 + Math.random() * 900000);
    return code.toString();
}

function startTimerCycle(serverCode) {
    function startTimer(timerIndex, remainingTime) {
        const timerDuration = 15000; // 15 seconds

        // Send the initial countdown to users
        io.to(serverCode).emit('countdownUpdate', { timerIndex, remainingTime });

        // Schedule countdown updates every second
        const countdownInterval = setInterval(() => {
            remainingTime -= 1000;

            // Send countdown updates to users
            io.to(serverCode).emit('countdownUpdate', { timerIndex, remainingTime });

            // Check if the timer has ended
            if (remainingTime <= 0) {
                clearInterval(countdownInterval);

                // Notify clients that the timer has ended
                io.to(serverCode).emit('timerEnded', { timerIndex });

                // Increment the timer index for the next cycle
                const nextTimerIndex = (timerIndex + 1) % 2;

                // Start the next timer in the cycle
                if (activeServers[serverCode].startTimer) {
                    startTimer(nextTimerIndex, timerDuration);
                }
            }
        }, 1000);

        // Save the interval ID in activeTimers
        activeServers[serverCode].timer = countdownInterval;
    }

    // Start the first timer in the cycle

    if (activeServers[serverCode].startTimer) {
        startTimer(0, 15000);
    }
}

function stopTimerCycle(serverCode) {
    // Clear the active timer if it exists
    if (activeServers[serverCode].timer) {
        clearInterval(activeServers[serverCode].timer);
        activeServers[serverCode].timer = null;
    }
}



const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});