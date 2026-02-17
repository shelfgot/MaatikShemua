"""Task status API endpoints."""
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.database import get_db
from app.models import BackgroundTask
from app.schemas import TaskResponse, TaskListResponse
from app.core.errors import NotFoundError

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/{task_id}/status", response_model=TaskResponse)
async def get_task_status(
    task_id: str,
    db: Session = Depends(get_db)
):
    """Get task status - fallback for WebSocket reconnection."""
    task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
    
    if not task:
        raise NotFoundError(f"Task {task_id} not found")
    
    return TaskResponse(
        task_id=task.id,
        type=task.type,
        status=task.status,
        progress=task.progress,
        result=task.result,
        error=task.error,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    status: Optional[str] = Query(None, description="Filter by status: pending, running, completed, failed"),
    task_type: Optional[str] = Query(None, description="Filter by type: inference, training"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of tasks to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    db: Session = Depends(get_db)
):
    """List all background tasks with optional filtering."""
    query = db.query(BackgroundTask)
    
    if status:
        query = query.filter(BackgroundTask.status == status)
    
    if task_type:
        query = query.filter(BackgroundTask.type == task_type)
    
    # Order by most recent first
    query = query.order_by(desc(BackgroundTask.created_at))
    
    total = query.count()
    tasks = query.offset(offset).limit(limit).all()
    
    items = [
        TaskResponse(
            task_id=task.id,
            type=task.type,
            status=task.status,
            progress=task.progress,
            result=task.result,
            error=task.error,
            created_at=task.created_at,
            updated_at=task.updated_at,
        )
        for task in tasks
    ]
    
    return TaskListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
    )


@router.delete("/{task_id}")
async def cancel_task(
    task_id: str,
    db: Session = Depends(get_db)
):
    """Cancel a running task (if possible)."""
    task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
    
    if not task:
        raise NotFoundError(f"Task {task_id} not found")
    
    if task.status in ("completed", "failed"):
        return {"status": "already_finished", "task_id": task_id}
    
    # Mark as failed/cancelled
    task.status = "failed"
    task.error = {"message": "Cancelled by user"}
    db.commit()
    
    return {"status": "cancelled", "task_id": task_id}
