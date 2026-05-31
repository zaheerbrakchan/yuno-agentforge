from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..runtime.nodes import log_queue
import asyncio
import json

router = APIRouter()
active_connections: list[WebSocket] = []


@router.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            try:
                event = await asyncio.wait_for(log_queue.get(), timeout=1.0)
                await websocket.send_text(json.dumps(event))
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                await websocket.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)
