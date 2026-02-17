import { useEffect, useRef, useState, useCallback } from 'react';
import { Task } from '../types';
import * as api from '../services/api';

interface UseWebSocketOptions {
  onMessage?: (data: Task) => void;
  onError?: (error: Event) => void;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

export function useWebSocket(taskId: string | null, options: UseWebSocketOptions = {}) {
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const [taskData, setTaskData] = useState<Task | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const taskStatusRef = useRef<string | null>(null); // Track task status in ref to avoid stale closure
  const maxAttempts = options.reconnectAttempts ?? 5;
  const interval = options.reconnectInterval ?? 2000;
  
  const connect = useCallback(() => {
    if (!taskId) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/progress/${taskId}`);
    wsRef.current = ws;
    setStatus('connecting');
    
    ws.onopen = () => {
      setStatus('open');
      attemptsRef.current = 0;
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as Task;
      setTaskData(data);
      taskStatusRef.current = data.status; // Update ref for closure access
      options.onMessage?.(data);
      
      // Close if task is complete
      if (data.status === 'completed' || data.status === 'failed') {
        ws.close();
      }
    };
    
    ws.onerror = (error) => {
      options.onError?.(error);
    };
    
    ws.onclose = () => {
      setStatus('closed');
      
      // Attempt reconnection if task not complete (use ref to get current status)
      if (taskStatusRef.current !== 'completed' && taskStatusRef.current !== 'failed') {
        if (attemptsRef.current < maxAttempts) {
          const delay = interval * Math.pow(2, attemptsRef.current);
          attemptsRef.current++;
          setTimeout(connect, delay);
        }
      }
    };
  }, [taskId, options, maxAttempts, interval]);
  
  useEffect(() => {
    if (taskId) {
      connect();
    }
    
    return () => {
      wsRef.current?.close();
    };
  }, [taskId, connect]);
  
  return { status, taskData };
}

// Fallback polling hook
export function useTaskPolling(taskId: string | null) {
  const [taskData, setTaskData] = useState<Task | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  
  useEffect(() => {
    if (!taskId) {
      setTaskData(null);
      return;
    }
    
    setIsPolling(true);
    let cancelled = false;
    
    const poll = async () => {
      if (cancelled) return;
      
      try {
        const data = await api.getTaskStatus(taskId);
        if (cancelled) return;
        
        setTaskData(data);
        
        if (data.status !== 'completed' && data.status !== 'failed') {
          setTimeout(poll, 2000);
        } else {
          setIsPolling(false);
        }
      } catch (error) {
        console.error('Polling error:', error);
        if (!cancelled) {
          setTimeout(poll, 5000);
        }
      }
    };
    
    poll();
    
    return () => {
      cancelled = true;
      setIsPolling(false);
    };
  }, [taskId]);
  
  return { taskData, isPolling };
}
