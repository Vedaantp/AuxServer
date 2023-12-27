const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

let activeServers = {};
const TIME_OUT = 900000;

app.use(cors({
    origin: ['auxapp://'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
}));
app.use(express.json());


app.get('/amountServers', (req, res) => {
    try {
        const numberOfServers = Object.keys(activeServers).length;
        res.json({ numberOfServers });
    } catch {
        console.error('Error handling /amountServers:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/activeServers', (req, res) => {
    try {
        const serverInfo = Object.keys(activeServers).map((serverCode) => {
            const serverData = activeServers[serverCode];

            const startTime = new Date(serverData.startTime);
            const currentTime = new Date();
            const uptimeMilliseconds = currentTime - startTime;

            const hours = Math.floor(uptimeMilliseconds / 3600000);
            const minutes = Math.floor((uptimeMilliseconds % 3600000) / 60000);
            const seconds = Math.floor((uptimeMilliseconds % 60000) / 1000);

            return {
                serverCode,
                startTime: serverData.startTime,
                upTime: `${hours} hours ${minutes} minutes ${seconds} seconds`,
                host: {
                    userId: serverData.host.userId,
                    username: serverData.host.username,
                    lastHeartbeat: serverData.host.lastHeartbeat,
                },
                users: serverData.users.map((user) => ({
                    userId: user.userId,
                    username: user.username,
                    lastHeartbeat: user.lastHeartbeat,
                })),
                songRequests: serverData.songRequests,
            };
        });

        const prettifiedJSON = JSON.stringify({ servers: serverInfo }, null, 4);

        res.setHeader('Content-Type', 'application/json');
        res.send(prettifiedJSON);
    } catch (error) {
        console.error('Error handling /activeServers:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

io.on('connection', (socket) => {
    socket.on('createServer', ({ username, userId }) => {
        const serverCode = generateUniqueCode();
        const currentDate = new Date();
        const formattedDate = currentDate.toISOString();
        activeServers[serverCode] = {
            startTime: formattedDate,
            users: [],
            host: {},
            timer: null,
            startTimer: false,
            heartbeatInterval: setInterval(() => { checkHeartbeats(serverCode) }, 60000),
            songRequests: [],
            votes: {}
        };
        activeServers[serverCode].host = { userId: userId, username: username, lastHeartbeat: Date.now() };
        socket.join(serverCode);
        socket.emit('serverCreated', { serverCode });
        io.to(serverCode).emit('updateUsers', { users: activeServers[serverCode].users, host: activeServers[serverCode].host });
    });

    socket.on('updateHost', ({ serverCode, username, userId }) => {

        if (activeServers[serverCode]) {
            if (activeServers[serverCode].host.userId === userId) {
                activeServers[serverCode].host.username = username;
                activeServers[serverCode].host.lastHeartbeat = Date.now();
            }

            socket.join(serverCode);
            io.to(serverCode).emit('updateUsers', { users: activeServers[serverCode].users, host: activeServers[serverCode].host });
            io.to(serverCode).emit("hostRejoined");
        } else {
            socket.emit("joinError", { message: "Join unsuccessfull." });
        }
    });

    socket.on('updateUser', ({ serverCode, username, userId }) => {

        if (activeServers[serverCode]) {
            const userIndex = activeServers[serverCode].users.findIndex(user => user.userId === userId);

            if (userIndex !== -1) {
                activeServers[serverCode].users[userIndex].username = username;
                activeServers[serverCode].users[userIndex].lastHeartbeat = Date.now();
                socket.join(serverCode);
                io.to(serverCode).emit('updateUsers', { users: activeServers[serverCode].users, host: activeServers[serverCode].host });
                io.to(serverCode).emit('userJoined', { userId: userId });
            } else {

                socket.emit("rejoinError", { message: "Join unsuccessfull." });
            }


        } else {
            socket.emit("joinError", { message: "Join unsuccessfull." });
        }
    });

    socket.on('joinServer', ({ serverCode, username, userId }) => {
        const server = activeServers[serverCode];

        if (server) {
            if (server.users.length < 5) {
                server.users.push({ userId: userId, username: username, lastHeartbeat: Date.now() });
                socket.join(serverCode);
                io.to(serverCode).emit('updateUsers', { users: server.users, host: server.host });
                io.to(serverCode).emit('userJoined', { userId: userId });
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
                io.to(serverCode).emit('updateUsers', { users: server.users, host: server.host });
                io.to(serverCode).emit('userStoppedRejoin', { users: userId });

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
            server.host.lastHeartbeat = Date.now();
            io.to(serverCode).emit('heartbeatReceived', { message: activeServers[serverCode].host.lastHeartbeat });
        }

        else if (server) {
            const userIndex = activeServers[serverCode].users.findIndex(user => user.userId === userId);

            if (userIndex !== -1) {
                activeServers[serverCode].users[userIndex].lastHeartbeat = Date.now();
            }
        }
    });

    socket.on("songRequest", ({ serverCode, userId, songInfo }) => {
        const server = activeServers[serverCode];

        if (server) {
            const userIndex = activeServers[serverCode].users.findIndex(user => user.userId === userId);

            if (userIndex !== -1) {
                if (songInfo.uri !== '') {
                    activeServers[serverCode].songRequests.push(songInfo);
                    sendSongRequests(serverCode);
                }
            }
        }
    });

    socket.on("songVote", ({ serverCode, userId, songInfo, voted }) => {
        const server = activeServers[serverCode];

        if (server) {
            const userIndex = activeServers[serverCode].users.findIndex(user => user.userId === userId);

            if (userIndex !== -1) {
                if (songInfo.uri !== '') {
                    if (voted) {
                        if (activeServers[serverCode].votes.hasOwnProperty(songInfo.uri)) {
                            activeServers[serverCode].votes[songInfo.uri] += 1;
                        } else {
                            activeServers[serverCode].votes[songInfo.uri] = 1;
                        }
                    } else {
                        if (activeServers[serverCode].votes.hasOwnProperty(songInfo.uri)) {
                            activeServers[serverCode].votes[songInfo.uri] = 0;
                        }
                    }


                    // } else {
                    //     if (!activeServers[serverCode].votes.hasOwnProperty(songInfo.uri)) {
                    //         activeServers[serverCode].votes[songInfo.uri] = 0;
                    //     }
                }
            }
        }
    });

    socket.on("getVotedSong", ({ serverCode, userId }) => {
        const server = activeServers[serverCode];

        if (server) {
            if (userId === server.host.userId) {
                calculateTopSong(serverCode);
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
                        activeServers[serverCode].songRequests = [];
                        startTimer(nextTimerIndex, 30000);
                    } else {
                        activeServers[serverCode].votes = {};
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

function sendSongRequests(serverCode) {
    io.to(serverCode).emit("requestedSongs", { songs: activeServers[serverCode].songRequests });
}

function calculateTopSong(serverCode) {

    let song;

    const maxValue = Math.max(...Object.values(activeServers[serverCode].votes));

    const keysWithMaxValue = Object.keys(activeServers[serverCode].votes).filter(key => activeServers[serverCode].votes[key] === maxValue);

    if (keysWithMaxValue.length > 1) {
        const randomIndex = Math.floor(Math.random() * keysWithMaxValue.length);
        song = keysWithMaxValue[randomIndex];
    } else {
        song = keysWithMaxValue[0];
    }


    if (song) {
        io.to(serverCode).emit("votedSong", { uri: song });
    } else {
        io.to(serverCode).emit('votedSong', { uri: '' });
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
        if (currentTime - activeServers[serverCode].host.lastHeartbeat > TIME_OUT) {
            io.to(serverCode).emit('hostTimedOut', { message: `Host left. ${serverCode} has closed.` });
            clearInterval(activeServers[serverCode].heartbeatInterval);
            server.startTimer = false;
            stopTimerCycle(serverCode);
            delete activeServers[serverCode];
        }
    }

    if (activeServers[serverCode]) {
        for (user of activeServers[serverCode].users) {
            if (currentTime - user.lastHeartbeat > TIME_OUT) {
                const userId = user.userId;
                activeServers[serverCode].users = activeServers[serverCode].users.filter((user) => user.userId !== userId);
                io.to(serverCode).emit('updateUsers', { users: activeServers[serverCode].users, host: activeServers[serverCode].host });
                io.to(serverCode).emit('userTimedOut', { userId: userId });
            }
        }
    }

}



const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});