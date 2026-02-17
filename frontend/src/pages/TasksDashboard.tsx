import { useEffect, useState, useCallback } from 'react';
import { Task } from '../types';
import * as api from '../services/api';
import { useAnnouncer } from '../hooks/useAnnouncer';

export default function TasksDashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({});
  const { announce } = useAnnouncer();
  
  const fetchTasks = useCallback(async () => {
    try {
      const response = await api.getTasks({
        status: filterStatus || undefined,
        type: filterType || undefined,
        limit: 100,
      });
      setTasks(response.items);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
      announce('Failed to load tasks', 'assertive');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterType, announce]);
  
  useEffect(() => {
    fetchTasks();
    
    // Auto-refresh every 3 seconds for active tasks
    const interval = setInterval(() => {
      fetchTasks();
    }, 3000);
    
    return () => clearInterval(interval);
  }, [fetchTasks]);
  
  const handleCancel = useCallback(async (taskId: string) => {
    if (!confirm('Are you sure you want to cancel this task?')) return;
    
    try {
      await api.cancelTask(taskId);
      announce('Task cancelled');
      await fetchTasks();
    } catch (error) {
      announce('Failed to cancel task', 'assertive');
    }
  }, [fetchTasks, announce]);
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'running':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };
  
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'inference':
        return 'Inference';
      case 'training':
        return 'Training';
      default:
        return type;
    }
  };
  
  const formatProgress = (progress: Task['progress']) => {
    if (!progress) return null;
    if (progress.message) return progress.message;
    if (progress.phase) return progress.phase;
    if (progress.status && progress.status !== 'pending') return progress.status;
    if (progress.current !== undefined && progress.total !== undefined && progress.total > 0) {
      const percent = Math.round((progress.current / progress.total) * 100);
      return `${progress.current} / ${progress.total} (${percent}%)`;
    }
    if (progress.status) return progress.status;
    return null;
  };

  /** Progress 0–100 for bar; null if indeterminate */
  const getProgressPercent = (progress: Task['progress']): number | null => {
    if (!progress?.total || progress.total <= 0) return null;
    if (progress.current == null) return null;
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
  };

  const isStuckPending = (task: Task) => {
    if (task.status !== 'pending') return false;
    const created = task.created_at ? new Date(task.created_at).getTime() : 0;
    const pendingMinutes = (Date.now() - created) / (60 * 1000);
    return pendingMinutes >= 10;
  };

  const timeAgo = (dateStr: string) => {
    const d = new Date(dateStr).getTime();
    const sec = Math.floor((Date.now() - d) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  };

  const prettyJson = (value: unknown) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };
  
  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };
  
  const activeTasks = tasks.filter(t => t.status === 'running' || t.status === 'pending');
  
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Tasks Dashboard</h2>
        <button
          onClick={fetchTasks}
          className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      
      {/* Filters */}
      <div className="mb-4 flex gap-4">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded"
        >
          <option value="">All Types</option>
          <option value="inference">Inference</option>
          <option value="training">Training</option>
        </select>
      </div>
      
      {/* Active tasks summary */}
      {activeTasks.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm font-medium text-blue-900">
            {activeTasks.length} active task{activeTasks.length !== 1 ? 's' : ''} running
          </p>
        </div>
      )}
      
      {loading ? (
        <p>Loading tasks...</p>
      ) : tasks.length === 0 ? (
        <p className="text-gray-500">No tasks found.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const progress = formatProgress(task.progress);
            const duration = task.updated_at && task.created_at
              ? Math.round((new Date(task.updated_at).getTime() - new Date(task.created_at).getTime()) / 1000)
              : null;
            const expanded = !!expandedTaskIds[task.task_id];
            
            return (
              <div
                key={task.task_id}
                data-testid={`task-card-${task.task_id}`}
                className="border rounded-lg p-2 bg-white hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(task.status)}`}>
                        {task.status}
                      </span>
                      <span className="px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700">
                        {getTypeLabel(task.type)}
                      </span>
                      <span className="text-xs text-gray-500 font-mono">
                        {task.task_id.substring(0, 8)}...
                      </span>
                    </div>
                    
                    {(progress || task.status === 'running' || task.status === 'pending') && (
                      <div className="mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-600">Progress:</span>
                          <span className="text-xs font-medium">{progress || task.progress?.phase || task.progress?.message || '—'}</span>
                          {(task.status === 'running' || task.status === 'pending') && task.updated_at && (
                            <span className="text-xs text-gray-400">Updated {timeAgo(task.updated_at)}</span>
                          )}
                        </div>
                        {(task.status === 'running' || task.status === 'pending') && (
                          <div className="w-full bg-gray-200 rounded-full h-2 mt-1 overflow-hidden">
                            {getProgressPercent(task.progress) != null ? (
                              <div
                                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${getProgressPercent(task.progress)!}%` }}
                                role="progressbar"
                                aria-valuenow={getProgressPercent(task.progress)!}
                                aria-valuemin={0}
                                aria-valuemax={100}
                              />
                            ) : (
                              <div className="h-2 rounded-full bg-blue-400 animate-pulse w-full max-w-full" style={{ width: '100%' }} role="progressbar" aria-valuetext="In progress" />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {isStuckPending(task) && (
                      <div className="mb-1 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800" role="alert">
                        This task has not started. If you use background workers, ensure a Celery worker is running.
                      </div>
                    )}
                    
                    {task.error && (
                      <div className="mb-1 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                        <strong>Error:</strong> {task.error.message || 'Task failed'}
                        {expanded && task.error && (
                          <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-red-900/80">
                            {prettyJson(task.error)}
                          </pre>
                        )}
                      </div>
                    )}
                    
                    {task.result && task.status === 'completed' && (
                      <div className="mb-1 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-800">
                        <strong>Result:</strong> {expanded ? '' : 'Available'}
                        {expanded && (
                          <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-green-900/80">
                            {prettyJson(task.result)}
                          </pre>
                        )}
                      </div>
                    )}

                    {(task.error || task.result) && (
                      <button
                        className="text-xs text-blue-700 hover:text-blue-900 underline mt-1"
                        onClick={() => setExpandedTaskIds(prev => ({ ...prev, [task.task_id]: !prev[task.task_id] }))}
                      >
                        {expanded ? 'Hide details' : 'Show details'}
                      </button>
                    )}
                    
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500 mt-1">
                      <span>Created: {formatDate(task.created_at)}</span>
                      {duration !== null && (
                        <span>Duration: {duration}s</span>
                      )}
                      {task.updated_at !== task.created_at && (
                        <span>Updated: {formatDate(task.updated_at)}</span>
                      )}
                    </div>
                  </div>
                  
                  {(task.status === 'running' || task.status === 'pending') && (
                    <button
                      onClick={() => handleCancel(task.task_id)}
                      className="ml-4 px-3 py-1 text-sm text-red-600 hover:text-red-800 border border-red-300 rounded hover:bg-red-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
