import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// WebSocket events
// WebSocket events
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  // When client draws, broadcast to ALL others
  socket.on('draw-event', (data) => {
    console.log('🎨 Draw event from:', socket.id, data);
    
    // Broadcast to everyone EXCEPT sender
    socket.broadcast.emit('remote-draw', {
      ...data,
      socketId: socket.id // So we know who drew it
    });
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server: http://localhost:${PORT}`);
});