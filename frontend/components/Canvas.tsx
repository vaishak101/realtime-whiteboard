'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
  
  // Undo/Redo state
  const historyRef = useRef<Array<{ action: string; data: any }>>([]);
  const historyIndexRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Update undo/redo button states
  const updateHistoryState = () => {
    setCanUndo(historyIndexRef.current >= 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  };

  // Add action to history
  const addToHistory = (action: string, data: any) => {
    // Remove any redo history
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    
    // Add new action
    historyRef.current.push({ action, data });
    historyIndexRef.current++;
    
    // Limit history to 50 actions
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
      historyIndexRef.current--;
    }
    
    updateHistoryState();
  };

  // Undo function
  const handleUndo = useCallback(() => {
    if (historyIndexRef.current < 0) return;
    
    const canvas = fabricCanvasRef.current;
    if (!canvas || !socket) return;

    const historyItem = historyRef.current[historyIndexRef.current];
    
    if (historyItem.action === 'add') {
      // Undo add = remove object
      const obj = canvas.getObjects().find((o: any) => o.id === historyItem.data.id);
      if (obj) {
        canvas.remove(obj);
        canvas.renderAll();
        
        // Emit removal to other users
        socket.emit('object-removed', {
          id: historyItem.data.id,
          timestamp: Date.now(),
        });
      }
    } else if (historyItem.action === 'remove') {
      // Undo remove = add object back
      fabric.util.enlivenObjects([historyItem.data.object]).then((objects: any[]) => {
        if (objects.length > 0) {
          const obj = objects[0];
          canvas.add(obj);
          canvas.renderAll();
          
          // Emit addition to other users
          socket.emit('object-added', {
            object: historyItem.data.object,
            timestamp: Date.now(),
          });
        }
      });
    } else if (historyItem.action === 'modify') {
      // Undo modify = restore old state
      const obj = canvas.getObjects().find((o: any) => o.id === historyItem.data.id);
      if (obj) {
        obj.set(historyItem.data.oldState);
        canvas.renderAll();
        
        // Emit modification to other users
        socket.emit('object-modified', {
          id: historyItem.data.id,
          object: obj.toObject(['id']),
          timestamp: Date.now(),
        });
      }
    }
    
    historyIndexRef.current--;
    updateHistoryState();
  }, [socket]);

  // Redo function
  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    
    const canvas = fabricCanvasRef.current;
    if (!canvas || !socket) return;

    historyIndexRef.current++;
    const historyItem = historyRef.current[historyIndexRef.current];
    
    if (historyItem.action === 'add') {
      // Redo add = add object
      fabric.util.enlivenObjects([historyItem.data.object]).then((objects: any[]) => {
        if (objects.length > 0) {
          const obj = objects[0];
          canvas.add(obj);
          canvas.renderAll();
          
          // Emit addition to other users
          socket.emit('object-added', {
            object: historyItem.data.object,
            timestamp: Date.now(),
          });
        }
      });
    } else if (historyItem.action === 'remove') {
      // Redo remove = remove object
      const obj = canvas.getObjects().find((o: any) => o.id === historyItem.data.id);
      if (obj) {
        canvas.remove(obj);
        canvas.renderAll();
        
        // Emit removal to other users
        socket.emit('object-removed', {
          id: historyItem.data.id,
          timestamp: Date.now(),
        });
      }
    } else if (historyItem.action === 'modify') {
      // Redo modify = apply new state
      const obj = canvas.getObjects().find((o: any) => o.id === historyItem.data.id);
      if (obj) {
        obj.set(historyItem.data.newState);
        canvas.renderAll();
        
        // Emit modification to other users
        socket.emit('object-modified', {
          id: historyItem.data.id,
          object: obj.toObject(['id']),
          timestamp: Date.now(),
        });
      }
    }
    
    updateHistoryState();
  }, [socket]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z (or Cmd+Z on Mac)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      
      // Redo: Ctrl+Y or Ctrl+Shift+Z (or Cmd+Y / Cmd+Shift+Z on Mac)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleRedo();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);
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
          
          // Store object data for undo
          const objectData = obj.toObject(['id']);
          
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
          
          // Add to history
          addToHistory('remove', {
            id: objWithId.id,
            object: objectData,
          });
          
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
      
      // Add to history
      addToHistory('add', {
        id: pathId,
        object: pathData,
      });
    };

    canvas.on('path:created', handlePathCreated);
    return () => canvas.off('path:created', handlePathCreated);
  }, [socket, mode]);

  // Handle object modifications (when user moves/resizes in select mode)
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !socket) return;

    let objectStateBeforeModify: any = null;

    const handleObjectModifying = (e: any) => {
      const object = e.target;
      if (!object || !object.id) return;
      
      // Store state before modification (only once per modification)
      if (!objectStateBeforeModify) {
        objectStateBeforeModify = {
          left: object.left,
          top: object.top,
          scaleX: object.scaleX,
          scaleY: object.scaleY,
          angle: object.angle,
        };
      }
    };

    const handleObjectModified = (e: any) => {
      const object = e.target;
      if (!object || !object.id) return;

      console.log('✏️ Object modified:', object.id);
      
      socket.emit('object-modified', {
        id: object.id,
        object: object.toObject(['id']),
        timestamp: Date.now(),
      });
      
      // Add to history
      if (objectStateBeforeModify) {
        addToHistory('modify', {
          id: object.id,
          oldState: objectStateBeforeModify,
          newState: {
            left: object.left,
            top: object.top,
            scaleX: object.scaleX,
            scaleY: object.scaleY,
            angle: object.angle,
          },
        });
        objectStateBeforeModify = null;
      }
    };

    canvas.on('object:moving', handleObjectModifying);
    canvas.on('object:scaling', handleObjectModifying);
    canvas.on('object:rotating', handleObjectModifying);
    canvas.on('object:modified', handleObjectModified);
    
    return () => {
      canvas.off('object:moving', handleObjectModifying);
      canvas.off('object:scaling', handleObjectModifying);
      canvas.off('object:rotating', handleObjectModifying);
      canvas.off('object:modified', handleObjectModified);
    };
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
      <div className="flex gap-2 items-center flex-wrap">
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
        
        <div className="w-px h-8 bg-gray-300"></div>
        
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          className={`px-4 py-3 rounded-lg font-medium transition ${
            canUndo
              ? 'bg-purple-600 text-white hover:bg-purple-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
          title="Undo (Ctrl+Z)"
        >
          ↶ Undo
        </button>
        
        <button
          onClick={handleRedo}
          disabled={!canRedo}
          className={`px-4 py-3 rounded-lg font-medium transition ${
            canRedo
              ? 'bg-purple-600 text-white hover:bg-purple-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
          title="Redo (Ctrl+Y)"
        >
          ↷ Redo
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