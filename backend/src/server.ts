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
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  // Listen for draw events
  socket.on('draw-event', (data) => {
    console.log('🎨 Draw event received:', data);
    // TODO: Broadcast to others (later)
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server: http://localhost:${PORT}`);
});