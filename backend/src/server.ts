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

// WebSocket events - Handle Fabric.js object operations
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  // When client adds an object, broadcast to ALL others
  socket.on('object-added', (data) => {
    console.log('➕ Object added from:', socket.id);
    
    // Broadcast to everyone EXCEPT sender
    socket.broadcast.emit('remote-object-added', {
      object: data.object,
      socketId: socket.id,
      timestamp: data.timestamp
    });
  });

  // When client modifies an object, broadcast to ALL others
  socket.on('object-modified', (data) => {
    console.log('✏️ Object modified from:', socket.id, 'ID:', data.id);
    
    // Broadcast to everyone EXCEPT sender
    socket.broadcast.emit('remote-object-modified', {
      id: data.id,
      object: data.object,
      socketId: socket.id,
      timestamp: data.timestamp
    });
  });

  // When client removes an object, broadcast to ALL others
  socket.on('object-removed', (data) => {
    console.log('🗑️ Object removed from:', socket.id, 'ID:', data.id);
    
    // Broadcast to everyone EXCEPT sender
    socket.broadcast.emit('remote-object-removed', {
      id: data.id,
      socketId: socket.id,
      timestamp: data.timestamp
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