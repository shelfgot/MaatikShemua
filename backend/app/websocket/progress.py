"""WebSocket handler for progress updates."""
from typing import Dict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session
import asyncio

from app.database import get_db, SessionLocal
from app.models import BackgroundTask
from app.core.logging import logger

progress_router = APIRouter()


class ConnectionManager:
    """Manage WebSocket connections."""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, task_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[task_id] = websocket
        logger.debug("websocket_connected", task_id=task_id)
    
    def disconnect(self, task_id: str):
        if task_id in self.active_connections:
            del self.active_connections[task_id]
            logger.debug("websocket_disconnected", task_id=task_id)
    
    async def send_progress(self, task_id: str, data: dict):
        if task_id in self.active_connections:
            try:
                await self.active_connections[task_id].send_json(data)
            except Exception as e:
                logger.warning("websocket_send_failed", task_id=task_id, error=str(e))
                self.disconnect(task_id)


manager = ConnectionManager()


@progress_router.websocket("/ws/progress/{task_id}")
async def websocket_progress(websocket: WebSocket, task_id: str):
    """WebSocket endpoint for task progress updates."""
    await manager.connect(task_id, websocket)
    
    try:
        # Poll task status and send updates
        while True:
            db = SessionLocal()
            try:
                task = db.query(BackgroundTask).filter(BackgroundTask.id == task_id).first()
                
                if task:
                    await manager.send_progress(task_id, {
                        "task_id": task.id,
                        "status": task.status,
                        "progress": task.progress,
                        "result": task.result,
                        "error": task.error,
                    })
                    
                    # Close if task is complete
                    if task.status in ("completed", "failed"):
                        break
            finally:
                db.close()
            
            # Wait before next poll
            await asyncio.sleep(1)
            
            # Check for client messages (ping/close)
            try:
                await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=0.1
                )
            except asyncio.TimeoutError:
                pass
            
    except WebSocketDisconnect:
        logger.debug("websocket_client_disconnected", task_id=task_id)
    except Exception as e:
        logger.error("websocket_error", task_id=task_id, error=str(e))
    finally:
        manager.disconnect(task_id)
