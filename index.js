const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const activeServers = {};
const TIME_OUT = 10000;

app.use(cors({
    origin: ['auxapp://'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
}));
app.use(express.json());


app.get('/amountServers', (req, res) => {
    const numberOfServers = Object.keys(activeServers).length;
    res.json({ numberOfServers });
});

app.get('/activeServers', (req, res) => {
    res.json({ activeServers });
});

io.on('connection', (socket) => {
    socket.on('createServer', ({ username, userId }) => {
        const serverCode = generateUniqueCode();
        activeServers[serverCode] = { users: [], host: {}, timer: null, startTimer: false, heartbeatInterval: setInterval(() => {checkHeartbeats(serverCode)}, 5000) };
        activeServers[serverCode].host = { userId: userId, username: username, lastHearbeat: Date.now() };
        socket.join(serverCode);
        socket.emit('serverCreated', { serverCode });
        io.to(serverCode).emit('userJoined', { users: activeServers[serverCode].users, host: activeServers[serverCode].host });
    });

    socket.on('updateHost', ({ serverCode, username, userId }) => {

        if (activeServers[serverCode]) {
            if (activeServers[serverCode].host.userId === userId) {
                activeServers[serverCode].host.username = username;
            }

            socket.join(serverCode);
            io.to(serverCode).emit('updateUsers', { users: activeServers[serverCode].users, host: activeServers[serverCode].host });
        } else {
            socket.emit("joinError", { message: "Join unsuccessfull." });
        }
    });

    socket.on('updateUser', ({ serverCode, username, userId }) => {

        if (activeServers[serverCode]) {
            const userIndex = activeServers[serverCode].users.findIndex(user => user.userId === userId);

            if (userIndex !== -1) {
                activeServers[serverCode].users[userIndex].username = username
                socket.join(serverCode);
                io.to(serverCode).emit('updateUsers', { users: activeServers[serverCode].users, host: activeServers[serverCode].host });
            } else {
                if (activeServers[serverCode].users.length < 5) {
                    server.users.push({ userId: userId, username: username, lastHearbeat: Date.now() });
                    socket.join(serverCode);
                    io.to(serverCode).emit('userJoined', { users: server.users, host: server.host });
                } else {
                    socket.emit('serverFull');
                }
            }

            
        } else {
            socket.emit("joinError", { message: "Join unsuccessfull." });
        }
    });

    socket.on('joinServer', ({ serverCode, username, userId }) => {
        const server = activeServers[serverCode];

        if (server) {
            if (server.users.length < 5) {
                server.users.push({ userId: userId, username: username, lastHearbeat: Date.now() });
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
                clearInterval(activeServers[serverCode].heartbeatInterval);
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

    socket.on("heartbeat", ({ serverCode, userId }) => {
        const server = activeServers[serverCode];

        if (server && server.host.userId === userId) {
            server.host.lastHearbeat = Date.now();
        }

        else if (server) {
            const userIndex = activeServers[serverCode].users.findIndex(user => user.userId === userId);

            if (userIndex !== -1) {
                activeServers[serverCode].users[userIndex].lastHearbeat = Date.now();
            }
        }
    });
});

function generateUniqueCode() {
    const code = Math.floor(100000 + Math.random() * 900000);
    return code.toString();
}

function startTimerCycle(serverCode) {
    function startTimer(timerIndex, remainingTime) {
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

                    if (nextTimerIndex === 0) {
                        startTimer(nextTimerIndex, 30000);
                    } else {
                        startTimer(nextTimerIndex, 15000);
                    }
                }
            }
        }, 1000);

        // Save the interval ID in activeTimers
        activeServers[serverCode].timer = countdownInterval;
    }

    // Start the first timer in the cycle

    if (activeServers[serverCode].startTimer) {
        startTimer(0, 30000);
    }
}

function stopTimerCycle(serverCode) {
    // Clear the active timer if it exists
    if (activeServers[serverCode].timer) {
        clearInterval(activeServers[serverCode].timer);
        activeServers[serverCode].timer = null;
    }
}

const checkHeartbeats = (serverCode) => {
    const currentTime = Date.now();

    if (activeServers[serverCode]) {
        if (currentTime - activeServers[serverCode].host.lastHearbeat > TIME_OUT) {
            io.to(serverCode).emit('hostTimedOut', { message: `Host left. ${serverCode} has closed.` });
            clearInterval(activeServers[serverCode].heartbeatInterval);
            server.startTimer = false;
            stopTimerCycle(serverCode);
            delete activeServers[serverCode];
        }
    }

    if (activeServers[serverCode]) {
        for (const user in activeServers[serverCode].users) {
            if (currentTime - user.lastHearbeat > TIME_OUT) {
                const userId = user.userId;
                activeServers[serverCode].users = activeServers[serverCode].users.filter((user) => user.userId !== userId);
                io.to(serverCode).emit('userLeft', { users: activeServers[serverCode].users, host: activeServers[serverCode].host });
            }
        }
    }

}



const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});