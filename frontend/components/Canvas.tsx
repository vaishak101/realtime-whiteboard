'use client';

import { useEffect, useRef, useState } from 'react';
import  * as fabric from 'fabric';
import { Socket } from 'socket.io-client';

interface CanvasProps {
  socket: Socket | null;
}

export default function Canvas({ socket }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const localObjectIds = useRef<Set<string>>(new Set());
  const remoteObjects = useRef<Map<string, any>>(new Map());
  const [mode, setMode] = useState<'pen' | 'eraser' | 'select'>('pen');
  const eraserCursorRef = useRef<fabric.Circle | null>(null);

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#ffffff',
      isDrawingMode: true,
    });

    // Setup default pen brush
    const brush = new fabric.PencilBrush(canvas);
    brush.color = '#000000';
    brush.width = 3;
    canvas.freeDrawingBrush = brush;

    fabricCanvasRef.current = canvas;
    console.log('✅ Canvas initialized');

    return () => canvas.dispose();
  }, []);

  // Handle mode changes
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Remove eraser cursor if it exists
    if (eraserCursorRef.current) {
      canvas.remove(eraserCursorRef.current);
      eraserCursorRef.current = null;
    }

    if (mode === 'pen') {
      canvas.isDrawingMode = true;
      canvas.selection = false;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = '#000000';
      brush.width = 3;
      canvas.freeDrawingBrush = brush;
      console.log('✏️ Pen mode');
    } else if (mode === 'eraser') {
      canvas.isDrawingMode = false;
      canvas.selection = false;
      
      // Disable selection completely in eraser mode
      canvas.discardActiveObject();
      
      // Make all objects non-selectable in eraser mode
      canvas.forEachObject((obj: any) => {
        if (obj !== eraserCursorRef.current) {
          obj.selectable = false;
          obj.hoverCursor = 'crosshair';
        }
      });
      
      // Create eraser cursor (visual indicator)
      const eraserCursor = new fabric.Circle({
        radius: 10,
        fill: 'rgba(255, 0, 0, 0.3)',
        stroke: '#ff0000',
        strokeWidth: 2,
        selectable: false,
        evented: false,
        originX: 'center',
        originY: 'center',
      });
      
      canvas.add(eraserCursor);
      eraserCursorRef.current = eraserCursor;
      
      console.log('🗑️ Eraser mode');
    } else {
      canvas.isDrawingMode = false;
      canvas.selection = true;
      
      // Make all objects selectable in select mode
      canvas.forEachObject((obj: any) => {
        if (obj !== eraserCursorRef.current) {
          obj.selectable = true;
          obj.evented = true;
        }
      });
      
      console.log('👆 Selection mode');
    }
    
    canvas.renderAll();
  }, [mode]);

  // Eraser: delete objects on click
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || mode !== 'eraser') return;

    const handleMouseMove = (e: any) => {
      const pointer = canvas.getPointer(e.e);
      
      // Move eraser cursor
      if (eraserCursorRef.current) {
        eraserCursorRef.current.set({
          left: pointer.x,
          top: pointer.y,
        });
        canvas.renderAll();
      }
    };

    const handleMouseDown = (e: any) => {
      const pointer = canvas.getPointer(e.e);
      
      // Find and delete object under the eraser immediately
      const objects = canvas.getObjects().slice().reverse();
      
      for (const obj of objects) {
        const objWithId = obj as any;
        
        // Skip the eraser cursor itself
        if (obj === eraserCursorRef.current) continue;
        
        // Skip objects without IDs
        if (!objWithId.id) continue;
        
        // Get the bounding rect with absolute coordinates
        const boundingRect = obj.getBoundingRect(true, true);
        
        // Expand the hit area for easier selection
        const hitMargin = 15;
        const isInBounds = 
          pointer.x >= boundingRect.left - hitMargin &&
          pointer.x <= boundingRect.left + boundingRect.width + hitMargin &&
          pointer.y >= boundingRect.top - hitMargin &&
          pointer.y <= boundingRect.top + boundingRect.height + hitMargin;
        
        if (isInBounds) {
          console.log('🗑️ Erasing object:', objWithId.id);
          
          // Remove from canvas
          canvas.remove(obj);
          
          // Emit deletion if object has an ID and socket is connected
          if (objWithId.id && socket?.connected) {
            console.log('🗑️ Emitting object-removed:', objWithId.id);
            socket.emit('object-removed', {
              id: objWithId.id,
              timestamp: Date.now(),
            });
            
            // Clean up tracking
            localObjectIds.current.delete(objWithId.id);
            remoteObjects.current.delete(objWithId.id);
          }
          
          canvas.renderAll();
          break; // Only erase one object per click
        }
      }
    };

    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:down', handleMouseDown);

    return () => {
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:down', handleMouseDown);
    };
  }, [mode, socket]);

  // Handle path creation (pen drawing)
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !socket) return;

    const handlePathCreated = (e: any) => {
      const path = e.path;
      if (!path) return;

      // Only handle pen strokes (eraser mode doesn't create paths anymore)
      if (mode !== 'pen') return;

      // Give it a unique ID
      const pathId = `path-${Date.now()}-${Math.random()}`;
      path.id = pathId;
      
      console.log('✏️ Drawing created:', pathId);
      
      // Remember this is ours
      localObjectIds.current.add(pathId);

      // Send to server - IMPORTANT: include 'id' in custom properties
      const pathData = path.toObject(['id']);
      console.log('📤 Sending path data with ID:', pathData.id);
      
      socket.emit('object-added', {
        object: pathData,
        timestamp: Date.now(),
      });
    };

    canvas.on('path:created', handlePathCreated);
    return () => canvas.off('path:created', handlePathCreated);
  }, [socket, mode]);

  // Handle object modifications (when user moves/resizes in select mode)
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !socket) return;

    const handleObjectModified = (e: any) => {
      const object = e.target;
      if (!object || !object.id) return;

      console.log('✏️ Object modified:', object.id);
      
      socket.emit('object-modified', {
        id: object.id,
        object: object.toObject(['id']),
        timestamp: Date.now(),
      });
    };

    canvas.on('object:modified', handleObjectModified);
    return () => canvas.off('object:modified', handleObjectModified);
  }, [socket]);

  // Receive drawings from others
  useEffect(() => {
    if (!socket) return;

    const handleRemoteDrawing = async (data: any) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      console.log('📥 Received data:', data.object);
      console.log('📥 Object ID:', data.object?.id);

      // Skip if this is our own drawing echoing back
      if (data.object?.id && localObjectIds.current.has(data.object.id)) {
        console.log('⏭️ Skipping my own drawing');
        return;
      }

      console.log('👥 Received remote drawing:', data.object?.id);

      try {
        // Convert JSON back to Fabric object
        const objects = await fabric.util.enlivenObjects([data.object]);
        if (objects.length > 0) {
          const path = objects[0] as any;
          
          // Make sure ID is preserved
          if (data.object.id) {
            path.id = data.object.id;
          }
          
          path.selectable = true;
          path.evented = true;
          
          canvas.add(path);
          canvas.renderAll();
          
          // Store remote objects so we can modify them later
          if (path.id) {
            remoteObjects.current.set(path.id, path);
            console.log('✅ Stored remote object:', path.id);
          }
        }
      } catch (error) {
        console.error('❌ Error adding remote drawing:', error);
      }
    };

    socket.on('remote-object-added', handleRemoteDrawing);
    return () => socket.off('remote-object-added', handleRemoteDrawing);
  }, [socket]);

  // Receive object modifications from others
  useEffect(() => {
    if (!socket) return;

    const handleRemoteModification = (data: any) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const remoteObj = remoteObjects.current.get(data.id);
      if (remoteObj) {
        console.log('👥 Remote object modified:', data.id);
        
        remoteObj.set({
          left: data.object.left,
          top: data.object.top,
          scaleX: data.object.scaleX,
          scaleY: data.object.scaleY,
          angle: data.object.angle,
        });
        
        canvas.renderAll();
      }
    };

    socket.on('remote-object-modified', handleRemoteModification);
    return () => socket.off('remote-object-modified', handleRemoteModification);
  }, [socket]);

  // Receive object removals from others
  useEffect(() => {
    if (!socket) return;

    const handleRemoteRemoval = (data: any) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      console.log('👥 Remote object removed:', data.id);

      // Check if it's a local object being removed by someone else
      const localObj = canvas.getObjects().find((obj: any) => obj.id === data.id);
      if (localObj) {
        canvas.remove(localObj);
        localObjectIds.current.delete(data.id);
        canvas.renderAll();
        return;
      }

      // Check if it's a remote object
      const remoteObj = remoteObjects.current.get(data.id);
      if (remoteObj) {
        canvas.remove(remoteObj);
        remoteObjects.current.delete(data.id);
        canvas.renderAll();
      }
    };

    socket.on('remote-object-removed', handleRemoteRemoval);
    return () => socket.off('remote-object-removed', handleRemoteRemoval);
  }, [socket]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <button
          onClick={() => setMode('pen')}
          className={`px-6 py-3 rounded-lg font-medium transition ${
            mode === 'pen'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
          }`}
        >
          ✏️ Pen
        </button>
        
        <button
          onClick={() => setMode('eraser')}
          className={`px-6 py-3 rounded-lg font-medium transition ${
            mode === 'eraser'
              ? 'bg-red-600 text-white'
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
          }`}
        >
          🗑️ Eraser (Click to delete)
        </button>
        
        <button
          onClick={() => setMode('select')}
          className={`px-6 py-3 rounded-lg font-medium transition ${
            mode === 'select'
              ? 'bg-green-600 text-white'
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
          }`}
        >
          👆 Select
        </button>
        
        <span className="text-sm text-gray-600 self-center ml-auto">
          {mode === 'pen' && 'Draw freely on the canvas'}
          {mode === 'eraser' && 'Click on any drawing to delete it'}
          {mode === 'select' && 'Click and drag to move objects'}
        </span>
      </div>
      
      <canvas
        ref={canvasRef}
        className="border-4 border-gray-400 rounded-lg shadow-lg"
        style={{ cursor: mode === 'select' ? 'default' : 'crosshair' }}
      />
    </div>
  );
}