'use client';

import { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { Socket } from 'socket.io-client';

interface CanvasProps {
  socket: Socket | null;
}

interface RemoteObject {
  id: string;
  socketId: string;
  object: any;
}

export default function Canvas({ socket }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const isLocalChange = useRef(false);
  const remoteObjects = useRef<Map<string, RemoteObject>>(new Map());
  const [drawingMode, setDrawingMode] = useState<'select' | 'pen' | 'eraser'>('select');

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const fabricCanvas = new fabric.Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: 'white',
      selection: true,
      preserveObjectStacking: true,
    });

    fabricCanvasRef.current = fabricCanvas;

    console.log('✅ Canvas initialized');

    return () => {
      fabricCanvas.dispose();
    };
  }, []);

  // Handle drawing mode changes
  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    if (drawingMode === 'pen') {
      fabricCanvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(fabricCanvas);
      brush.color = '#000000';
      brush.width = 3;
      fabricCanvas.freeDrawingBrush = brush;
      fabricCanvas.selection = false;
    } else if (drawingMode === 'eraser') {
      fabricCanvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(fabricCanvas);
      brush.color = '#FFFFFF';
      brush.width = 20;
      fabricCanvas.freeDrawingBrush = brush;
      fabricCanvas.selection = false;
    } else {
      fabricCanvas.isDrawingMode = false;
      fabricCanvas.selection = true;
    }
    fabricCanvas.renderAll();
  }, [drawingMode]);

  // Handle PATH CREATED (for pen/eraser drawing)
  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !socket) return;

    const handlePathCreated = (e: any) => {
      if (!e.path) return;

      const path = e.path as any;
      path.id = `path-${Date.now()}-${Math.random()}`;
      
      console.log('🎨 Path created locally:', path.id);

      // Mark as local to prevent object:added from double-emitting
      isLocalChange.current = true;

      const serialized = path.toJSON(['id']);
      socket.emit('object-added', {
        object: serialized,
        timestamp: Date.now(),
      });

      // Reset flag after a tick (let object:added handler run first)
      setTimeout(() => {
        isLocalChange.current = false;
      }, 0);
    };

    fabricCanvas.on('path:created', handlePathCreated);

    return () => {
      fabricCanvas.off('path:created', handlePathCreated);
    };
  }, [socket]);

  // Handle OBJECT ADDED (for shapes like rectangles/circles)
  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !socket) return;

    const handleObjectAdded = (e: any) => {
      if (!e.target) return;

      const object = e.target as any;

      // Skip if this is a path (paths are handled by path:created event)
      if (object.type === 'path') {
        console.log('⏭️ Skipping object:added (path handled separately):', object.id);
        return;
      }

      // Skip if this is a local change (shape added)
      if (isLocalChange.current) {
        console.log('⏭️ Skipping object:added (local change):', object.id);
        return;
      }

      // Skip if object already has an ID (already processed)
      if (object.id) {
        console.log('⏭️ Skipping object:added (already has ID):', object.id);
        return;
      }

      // This shouldn't happen, but just in case
      object.id = `obj-${Date.now()}-${Math.random()}`;
      console.log('🎨 Object added (fallback):', object.id);

      const serialized = object.toJSON(['id']);
      socket.emit('object-added', {
        object: serialized,
        timestamp: Date.now(),
      });
    };

    fabricCanvas.on('object:added', handleObjectAdded);

    return () => {
      fabricCanvas.off('object:added', handleObjectAdded);
    };
  }, [socket]);

  // Handle OBJECT MODIFIED
  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !socket) return;

    const handleObjectModified = (e: any) => {
      if (!e.target || isLocalChange.current) return;

      const object = e.target as any;
      console.log('✏️ Object modified:', object.id);

      const serialized = object.toJSON(['id']);
      socket.emit('object-modified', {
        id: object.id,
        object: serialized,
        timestamp: Date.now(),
      });
    };

    fabricCanvas.on('object:modified', handleObjectModified);

    return () => {
      fabricCanvas.off('object:modified', handleObjectModified);
    };
  }, [socket]);

  // Handle DELETE key
  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !socket) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace')) {
        const activeObject = fabricCanvas.getActiveObject() as any;
        if (activeObject && activeObject.id) {
          console.log('🗑️ Deleting object:', activeObject.id);
          
          socket.emit('object-removed', {
            id: activeObject.id,
            timestamp: Date.now(),
          });
          
          isLocalChange.current = true;
          fabricCanvas.remove(activeObject);
          fabricCanvas.renderAll();
          
          setTimeout(() => {
            isLocalChange.current = false;
          }, 0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [socket]);

  // Listen for REMOTE object additions
  useEffect(() => {
    if (!socket) return;

    const handleRemoteObjectAdded = async (data: { 
      object: any; 
      socketId: string; 
      timestamp: number 
    }) => {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas) return;

      console.log('👥 Remote object received:', data.object.id);

      try {
        isLocalChange.current = true;

        const objects = await fabric.util.enlivenObjects([data.object]);
        if (objects.length > 0) {
          const obj = objects[0] as any;
          
          // Keep paths selectable, disable other remote objects
          if (obj.type === 'path') {
            obj.selectable = true;
            obj.evented = true;
          } else {
            obj.selectable = false;
            obj.evented = false;
          }
          
          fabricCanvas.add(obj);
          fabricCanvas.renderAll();
          
          remoteObjects.current.set(obj.id, {
            id: obj.id,
            socketId: data.socketId,
            object: obj,
          });
        }

        setTimeout(() => {
          isLocalChange.current = false;
        }, 0);
      } catch (error) {
        console.error('❌ Error adding remote object:', error);
        isLocalChange.current = false;
      }
    };

    socket.on('remote-object-added', handleRemoteObjectAdded);

    return () => {
      socket.off('remote-object-added', handleRemoteObjectAdded);
    };
  }, [socket]);

  // Listen for REMOTE object modifications
  useEffect(() => {
    if (!socket) return;

    const handleRemoteObjectModified = (data: {
      id: string;
      object: any;
      socketId: string;
      timestamp: number;
    }) => {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas) return;

      console.log('👥 Remote object modified:', data.id);

      const remoteObj = remoteObjects.current.get(data.id);
      if (remoteObj) {
        isLocalChange.current = true;
        
        remoteObj.object.set({
          left: data.object.left,
          top: data.object.top,
          scaleX: data.object.scaleX,
          scaleY: data.object.scaleY,
          angle: data.object.angle,
        });
        
        fabricCanvas.renderAll();
        
        setTimeout(() => {
          isLocalChange.current = false;
        }, 0);
      }
    };

    socket.on('remote-object-modified', handleRemoteObjectModified);

    return () => {
      socket.off('remote-object-modified', handleRemoteObjectModified);
    };
  }, [socket]);

  // Listen for REMOTE object removals
  useEffect(() => {
    if (!socket) return;

    const handleRemoteObjectRemoved = (data: { 
      id: string; 
      socketId: string; 
      timestamp: number 
    }) => {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas) return;

      console.log('👥 Remote object removed:', data.id);

      const remoteObj = remoteObjects.current.get(data.id);
      if (remoteObj) {
        isLocalChange.current = true;
        
        fabricCanvas.remove(remoteObj.object);
        remoteObjects.current.delete(data.id);
        fabricCanvas.renderAll();
        
        setTimeout(() => {
          isLocalChange.current = false;
        }, 0);
      }
    };

    socket.on('remote-object-removed', handleRemoteObjectRemoved);

    return () => {
      socket.off('remote-object-removed', handleRemoteObjectRemoved);
    };
  }, [socket]);

  // Add rectangle
  const addRectangle = () => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !socket) return;

    const id = `rect-${Date.now()}-${Math.random()}`;
    console.log('🎨 Adding rectangle:', id);

    isLocalChange.current = true;

    const rectangle = new fabric.Rect({
      left: 100,
      top: 100,
      width: 100,
      height: 80,
      fill: '#FF6B6B',
      id: id,
    });

    fabricCanvas.add(rectangle);
    fabricCanvas.setActiveObject(rectangle);
    fabricCanvas.renderAll();

    const serialized = rectangle.toJSON();
    socket.emit('object-added', {
      object: serialized,
      timestamp: Date.now(),
    });

    setTimeout(() => {
      isLocalChange.current = false;
    }, 0);
  };

  // Add circle
  const addCircle = () => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !socket) return;

    const id = `circle-${Date.now()}-${Math.random()}`;
    console.log('🎨 Adding circle:', id);

    isLocalChange.current = true;

    const circle = new fabric.Circle({
      left: 150,
      top: 150,
      radius: 50,
      fill: '#4ECDC4',
      id: id,
    });

    fabricCanvas.add(circle);
    fabricCanvas.setActiveObject(circle);
    fabricCanvas.renderAll();

    const serialized = circle.toJSON();
    socket.emit('object-added', {
      object: serialized,
      timestamp: Date.now(),
    });

    setTimeout(() => {
      isLocalChange.current = false;
    }, 0);
  };

  // Delete selected object
  const deleteSelected = () => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !socket) return;

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (activeObject && activeObject.id) {
      console.log('🗑️ Deleting selected:', activeObject.id);
      
      socket.emit('object-removed', {
        id: activeObject.id,
        timestamp: Date.now(),
      });
      
      isLocalChange.current = true;
      fabricCanvas.remove(activeObject);
      fabricCanvas.renderAll();
      
      setTimeout(() => {
        isLocalChange.current = false;
      }, 0);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {/* Drawing Mode Buttons */}
        <button
          onClick={() => setDrawingMode('select')}
          className={`px-4 py-2 rounded transition ${
            drawingMode === 'select'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
          }`}
        >
          Select
        </button>
        <button
          onClick={() => setDrawingMode('pen')}
          className={`px-4 py-2 rounded transition ${
            drawingMode === 'pen'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
          }`}
        >
          ✏️ Pen
        </button>
        <button
          onClick={() => setDrawingMode('eraser')}
          className={`px-4 py-2 rounded transition ${
            drawingMode === 'eraser'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
          }`}
        >
          🗑️ Eraser
        </button>

        <div className="w-full border-t"></div>

        {/* Object Buttons */}
        <button
          onClick={addRectangle}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition"
        >
          Add Rectangle
        </button>
        <button
          onClick={addCircle}
          className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 transition"
        >
          Add Circle
        </button>
        <button
          onClick={deleteSelected}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition"
        >
          Delete Selected
        </button>
        <span className="text-sm text-gray-600 ml-auto self-center">
          {drawingMode === 'pen' && 'Draw freely on canvas'}
          {drawingMode === 'eraser' && 'Erase drawings'}
          {drawingMode === 'select' && 'Click and drag to move • Press Delete to remove'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="border-2 border-gray-300 bg-white rounded cursor-crosshair"
      />
    </div>
  );
}