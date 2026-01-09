'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const isDrawing = useRef(false);
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

    // 2. Listen for REMOTE draw events
    socketRef.current.on('remote-draw', (data) => {
      console.log('👥 Remote draw received:', data);
      drawRemotePoint(data.x, data.y);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // 3. Draw remote user's point
  const drawRemotePoint = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw remote user's stroke in different color
    ctx.strokeStyle = 'blue'; // Remote users = blue
    ctx.lineWidth = 2;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  // 4. Local drawing handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 800;
    canvas.height = 600;

    const startDrawing = (e: MouseEvent) => {
      isDrawing.current = true;
      ctx.strokeStyle = 'black'; // Your strokes = black
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.offsetX, e.offsetY);
    };

    const draw = (e: MouseEvent) => {
      if (!isDrawing.current) return;

      const x = e.offsetX;
      const y = e.offsetY;

      // Draw locally
      ctx.lineTo(x, y);
      ctx.stroke();

      // Send to server
      socketRef.current?.emit('draw-event', {
        x,
        y,
        timestamp: Date.now()
      });
    };

    const stopDrawing = () => {
      isDrawing.current = false;
      ctx.beginPath(); // Reset path
    };

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    return () => {
      canvas.removeEventListener('mousedown', startDrawing);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDrawing);
      canvas.removeEventListener('mouseleave', stopDrawing);
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="bg-white p-4 rounded-lg shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Whiteboard - Multiplayer Test</h1>
          <span className={`px-3 py-1 rounded text-sm ${
            connectionStatus === 'Connected' 
              ? 'bg-green-100 text-green-800' 
              : 'bg-red-100 text-red-800'
          }`}>
            {connectionStatus}
          </span>
        </div>
        <p className="text-sm text-gray-600 mb-2">
          Your strokes: <span className="text-black font-bold">Black</span> | 
          Others: <span className="text-blue-600 font-bold">Blue</span>
        </p>
        <canvas
          ref={canvasRef}
          className="border-2 border-gray-300 cursor-crosshair bg-white"
        />
      </div>
    </main>
  );
}