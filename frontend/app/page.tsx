'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    // Connect to WebSocket
    socketRef.current = io('http://localhost:3001');
    
    socketRef.current.on('connect', () => {
      console.log('✅ Connected to server');
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = 800;
    canvas.height = 600;

    // Drawing handlers
    const startDrawing = (e: MouseEvent) => {
      isDrawing.current = true;
      ctx.beginPath();
      ctx.moveTo(e.offsetX, e.offsetY);
    };

    const draw = (e: MouseEvent) => {
      if (!isDrawing.current) return;

      ctx.lineTo(e.offsetX, e.offsetY);
      ctx.stroke();

      // Emit to server
      socketRef.current?.emit('draw-event', {
        x: e.offsetX,
        y: e.offsetY,
        timestamp: Date.now()
      });
    };

    const stopDrawing = () => {
      isDrawing.current = false;
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
        <h1 className="text-2xl font-bold mb-4">Whiteboard Test</h1>
        <canvas
          ref={canvasRef}
          className="border-2 border-gray-300 cursor-crosshair"
        />
      </div>
    </main>
  );
}