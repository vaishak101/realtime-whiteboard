'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import Canvas from '@/components/Canvas';

export default function Home() {
  const socketRef = useRef<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');

  // 1. WebSocket Setup
  useEffect(() => {
    socketRef.current = io('http://localhost:3001');
    
    socketRef.current.on('connect', () => {
      console.log('✅ Connected to server');
      setConnectionStatus('Connected');
    });

    socketRef.current.on('disconnect', () => {
      console.log('❌ Disconnected from server');
      setConnectionStatus('Disconnected');
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Collaborative Whiteboard</h1>
          <span className={`px-3 py-1 rounded text-sm font-semibold ${
            connectionStatus === 'Connected' 
              ? 'bg-green-100 text-green-800' 
              : 'bg-red-100 text-red-800'
          }`}>
            {connectionStatus}
          </span>
        </div>
        
        {/* Fabric.js Canvas Component */}
        <Canvas socket={socketRef.current} />
      </div>
    </main>
  );
}