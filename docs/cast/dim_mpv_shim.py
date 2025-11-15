"""
Dim MPV Shim - Example implementation for casting to MPV player
Based on jellyfin-mpv-shim architecture

This is a starter implementation showing how to adapt jellyfin-mpv-shim
to work with Dim's cast protocol.

Requirements:
- python-mpv
- websockets
- requests
"""

import asyncio
import json
import logging
import mpv
import websockets
import uuid
from typing import Optional
from urllib.parse import urljoin

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dim-mpv-shim")


class DimMpvShim:
    def __init__(self, server_url: str, auth_token: str, device_name: str = "Dim MPV Player"):
        """
        Initialize Dim MPV Shim
        
        Args:
            server_url: URL of Dim server (e.g., "http://localhost:8000")
            auth_token: Authentication token from Dim
            device_name: Name to display in Dim UI
        """
        self.server_url = server_url.rstrip("/")
        self.auth_token = auth_token
        self.device_name = device_name
        self.device_id = str(uuid.uuid4())
        
        # Initialize MPV player
        self.player = mpv.MPV(
            input_default_bindings=True,
            input_vo_keyboard=True,
            osc=True,
        )
        
        # Session tracking
        self.current_session_id: Optional[str] = None
        self.ws_connection: Optional[websockets.WebSocketClientProtocol] = None
        
        # Setup MPV event handlers
        self._setup_player_events()
    
    def _setup_player_events(self):
        """Setup MPV event handlers"""
        
        @self.player.event_callback("start-file")
        def on_start_file(_event):
            logger.info("Playback started")
            if self.current_session_id:
                asyncio.create_task(self._send_state_update("playing"))
        
        @self.player.event_callback("pause")
        def on_pause(_event):
            paused = self.player.pause
            logger.info(f"Playback {'paused' if paused else 'resumed'}")
            if self.current_session_id:
                state = "paused" if paused else "playing"
                asyncio.create_task(self._send_state_update(state))
        
        @self.player.event_callback("end-file")
        def on_end_file(_event):
            logger.info("Playback ended")
            if self.current_session_id:
                asyncio.create_task(self._send_state_update("stopped"))
                self.current_session_id = None
        
        @self.player.property_observer("time-pos")
        def on_time_pos_change(_name, value):
            # Send position updates every few seconds
            if value and self.current_session_id and int(value) % 5 == 0:
                asyncio.create_task(self._send_state_update())
    
    async def _send_state_update(self, state: Optional[str] = None):
        """Send playback state update to server"""
        if not self.ws_connection or not self.current_session_id:
            return
        
        # Determine current state
        if state is None:
            if self.player.pause:
                state = "paused"
            elif self.player.path:
                state = "playing"
            else:
                state = "stopped"
        
        # Get current position
        position_ms = int((self.player.time_pos or 0) * 1000)
        duration_ms = int((self.player.duration or 0) * 1000)
        
        message = {
            "type": "state_update",
            "session_id": self.current_session_id,
            "state": state,
            "position_ms": position_ms,
            "duration_ms": duration_ms,
        }
        
        try:
            await self.ws_connection.send(json.dumps(message))
        except Exception as e:
            logger.error(f"Failed to send state update: {e}")
    
    async def _send_ack(self, command: str):
        """Send acknowledgment for a command"""
        if not self.ws_connection or not self.current_session_id:
            return
        
        message = {
            "type": "ack",
            "session_id": self.current_session_id,
            "command": command,
        }
        
        await self.ws_connection.send(json.dumps(message))
    
    async def _handle_play(self, data: dict):
        """Handle play command from server"""
        logger.info(f"Playing: {data['media_info']['title']}")
        
        self.current_session_id = data["session_id"]
        
        # Use direct file path if available, otherwise use streaming URL
        if data.get("file_path") and data["media_info"].get("direct_play"):
            media_path = data["file_path"]
            logger.info(f"Direct playing: {media_path}")
        else:
            media_path = urljoin(self.server_url, data["media_url"])
            # Add auth header for streaming
            media_path = f"{media_path}#Authorization={self.auth_token}"
            logger.info(f"Streaming from: {media_path}")
        
        # Load and play
        self.player.play(media_path)
        
        # Seek to start position if specified
        start_pos_ms = data.get("start_position_ms", 0)
        if start_pos_ms > 0:
            self.player.seek(start_pos_ms / 1000.0, reference="absolute")
        
        # Load subtitles if available
        if data.get("subtitle_url"):
            sub_url = urljoin(self.server_url, data["subtitle_url"])
            self.player.sub_add(sub_url)
        
        await self._send_ack("play")
    
    async def _handle_pause(self, data: dict):
        """Handle pause command"""
        logger.info("Pausing playback")
        self.player.pause = True
        await self._send_ack("pause")
    
    async def _handle_resume(self, data: dict):
        """Handle resume command"""
        logger.info("Resuming playback")
        self.player.pause = False
        await self._send_ack("resume")
    
    async def _handle_stop(self, data: dict):
        """Handle stop command"""
        logger.info("Stopping playback")
        self.player.stop()
        self.current_session_id = None
        await self._send_ack("stop")
    
    async def _handle_seek(self, data: dict):
        """Handle seek command"""
        position_ms = data["position_ms"]
        logger.info(f"Seeking to {position_ms}ms")
        self.player.seek(position_ms / 1000.0, reference="absolute")
        await self._send_ack("seek")
    
    async def _handle_set_volume(self, data: dict):
        """Handle volume change"""
        volume = data["volume"]
        logger.info(f"Setting volume to {volume}")
        self.player.volume = volume
        await self._send_ack("set_volume")
    
    async def _handle_message(self, message: str):
        """Handle incoming WebSocket message"""
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "connected":
                logger.info("Connected to Dim server")
            elif msg_type == "play":
                await self._handle_play(data)
            elif msg_type == "pause":
                await self._handle_pause(data)
            elif msg_type == "resume":
                await self._handle_resume(data)
            elif msg_type == "stop":
                await self._handle_stop(data)
            elif msg_type == "seek":
                await self._handle_seek(data)
            elif msg_type == "set_volume":
                await self._handle_set_volume(data)
            elif msg_type == "ping":
                # Respond to ping
                await self.ws_connection.send(json.dumps({"type": "pong"}))
            else:
                logger.warning(f"Unknown message type: {msg_type}")
        
        except Exception as e:
            logger.error(f"Error handling message: {e}")
            if self.current_session_id:
                error_msg = {
                    "type": "error",
                    "session_id": self.current_session_id,
                    "error": str(e),
                }
                await self.ws_connection.send(json.dumps(error_msg))
    
    async def connect(self):
        """Connect to Dim server via WebSocket"""
        ws_url = self.server_url.replace("http://", "ws://").replace("https://", "wss://")
        ws_url = f"{ws_url}/api/v1/cast/ws"
        
        logger.info(f"Connecting to {ws_url}")
        
        async with websockets.connect(ws_url) as websocket:
            self.ws_connection = websocket
            
            # Register this device
            register_msg = {
                "type": "register",
                "device_id": self.device_id,
                "device_name": self.device_name,
                "device_type": "mpvshim",
                "capabilities": {
                    "direct_play": True,
                    "video_codecs": [
                        "h264", "hevc", "h265", "av1", "vp9", "mpeg4",
                        "mpeg2", "vc1", "wmv3", "xvid"
                    ],
                    "audio_codecs": [
                        "aac", "mp3", "opus", "vorbis", "flac",
                        "ac3", "eac3", "dts", "truehd", "pcm"
                    ],
                    "subtitle_formats": ["srt", "ass", "ssa", "vtt", "sub"],
                    "max_resolution": "4k",
                },
            }
            
            await websocket.send(json.dumps(register_msg))
            logger.info("Device registered")
            
            # Listen for messages
            try:
                async for message in websocket:
                    await self._handle_message(message)
            except websockets.exceptions.ConnectionClosed:
                logger.info("Connection closed")
            finally:
                self.ws_connection = None
    
    async def run(self):
        """Main run loop with reconnection"""
        while True:
            try:
                await self.connect()
            except Exception as e:
                logger.error(f"Connection error: {e}")
            
            logger.info("Reconnecting in 5 seconds...")
            await asyncio.sleep(5)


def main():
    """Main entry point"""
    import sys
    
    if len(sys.argv) < 3:
        print("Usage: python dim_mpv_shim.py <server_url> <auth_token> [device_name]")
        print("Example: python dim_mpv_shim.py http://localhost:8000 your-token-here 'Living Room MPV'")
        sys.exit(1)
    
    server_url = sys.argv[1]
    auth_token = sys.argv[2]
    device_name = sys.argv[3] if len(sys.argv) > 3 else "Dim MPV Player"
    
    shim = DimMpvShim(server_url, auth_token, device_name)
    
    try:
        asyncio.run(shim.run())
    except KeyboardInterrupt:
        logger.info("Shutting down...")


if __name__ == "__main__":
    main()
