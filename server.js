const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// MongoDB connection
const uri = 'mongodb://localhost:27017/game';
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

let db;
client.connect()
    .then(() => {
        console.log('Connected to MongoDB');
        db = client.db();
    })
    .catch((err) => {
        console.error('Failed to connect to MongoDB:', err);
    });

// Serve static files
app.use(express.static('public'));

// Game state
let currentGame = null;
let questionInterval = null;
const playerScores = new Map(); // Track player scores

// Socket.IO logic
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Admin creates a game
    socket.on('create game', async () => {
        const code = Math.floor(100000 + Math.random() * 900000).toString(); // Generate a 6-digit code
        const game = {
            code,
            teacherId: socket.id,
            students: [],
            status: 'waiting',
            createdAt: new Date(),
            startedAt: null,
            endedAt: null,
        };

        await db.collection('games').insertOne(game);
        currentGame = game; // Store the current game
        socket.emit('game code', code); // Send the code to the admin
    });

    // Student joins a game
    socket.on('join game', async (code) => {
        const game = await db.collection('games').findOne({ code });
        if (game) {
            game.students.push(socket.id);
            await db.collection('games').updateOne({ _id: game._id }, { $set: { students: game.students } });
            socket.emit('join success', 'You have joined the game!');
            io.to(game.teacherId).emit('player count', game.students.length); // Notify admin of player count
        } else {
            socket.emit('join error', 'Invalid game code.');
        }
    });

    // Admin starts the game
    socket.on('start game', async (code) => {
        const game = await db.collection('games').findOne({ code });
        if (game) {
            await db.collection('games').updateOne({ _id: game._id }, { $set: { status: 'started', startedAt: new Date() } });
            io.emit('game started'); // Notify all users

            // Start sending questions with a timer
            sendRandomQuestion(game);
            questionInterval = setInterval(() => sendRandomQuestion(game), 15000); // 15 seconds per question
        }
    });

    // Student submits an answer
    socket.on('submit answer', async (data) => {
        const { questionId, answer } = data;
        const question = await db.collection('questions').findOne({ _id: new ObjectId(questionId) });

        if (question) {
            const isCorrect = answer === question.CORRECTRESPONSE; // Use CORRECTRESPONSE from the database
            const playerId = socket.id;

            // Update player score
            const currentScore = playerScores.get(playerId) || 0;
            playerScores.set(playerId, currentScore + (isCorrect ? 1 : 0));

            // Notify student of their answer result
            socket.emit('answer result', {
                isCorrect,
                selectedAnswer: answer,
                correctAnswer: question.CORRECTRESPONSE,
                score: playerScores.get(playerId),
            });
        }
    });

    // Helper function to send a random question
    async function sendRandomQuestion(game) {
        const questions = await db.collection('questions').find().toArray();
        const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
        io.to(game.students).emit('new question', {
            _id: randomQuestion._id, // Include the question ID
            question: randomQuestion.QUESTION, // Use QUESTION from the database
            options: [
                randomQuestion.CORRECTRESPONSE,
                randomQuestion.RESPONSE2,
                randomQuestion.RESPONSE3,
                randomQuestion.RESPONSE4,
            ],
        });
    }

    // Handle user disconnect
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        if (currentGame && currentGame.teacherId === socket.id) {
            clearInterval(questionInterval); // Stop the timer if the admin disconnects
        }
    });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});