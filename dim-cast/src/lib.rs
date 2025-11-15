use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::sync::mpsc;
use uuid::Uuid;

pub mod protocol;
pub mod session;

pub use protocol::*;
pub use session::*;

/// Cast manager that handles multiple cast sessions
#[derive(Clone)]
pub struct CastManager {
    sessions: Arc<RwLock<HashMap<Uuid, CastSession>>>,
    devices: Arc<RwLock<HashMap<String, CastDeviceConnection>>>,
}

/// Device connection with message sender
#[derive(Clone)]
pub struct CastDeviceConnection {
    pub device: CastDevice,
    pub sender: mpsc::UnboundedSender<ServerMessage>,
}

impl std::fmt::Debug for CastManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CastManager")
            .field("sessions", &"<RwLock<HashMap>>")
            .field("devices", &"<RwLock<HashMap>>")
            .finish()
    }
}

impl Default for CastManager {
    fn default() -> Self {
        Self::new()
    }
}

impl CastManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            devices: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a new cast device
    pub async fn register_device(&self, device: CastDevice, sender: mpsc::UnboundedSender<ServerMessage>) {
        let mut devices = self.devices.write().await;
        tracing::info!("Registering cast device: {} ({})", device.name, device.device_id);
        let connection = CastDeviceConnection { device, sender };
        devices.insert(connection.device.device_id.clone(), connection);
    }

    /// Unregister a cast device
    pub async fn unregister_device(&self, device_id: &str) {
        let mut devices = self.devices.write().await;
        tracing::info!("Unregistering cast device: {}", device_id);
        devices.remove(device_id);

        // Also cleanup any sessions for this device
        let mut sessions = self.sessions.write().await;
        sessions.retain(|_, session| session.device_id != device_id);
    }

        /// Get all registered devices
    pub async fn get_devices(&self) -> Vec<CastDevice> {
        let devices = self.devices.read().await;
        devices.values().map(|conn| conn.device.clone()).collect()
    }

    /// Send a message to a specific device
    pub async fn send_to_device(&self, device_id: &str, message: ServerMessage) -> Result<(), CastError> {
        let devices = self.devices.read().await;
        let connection = devices.get(device_id).ok_or(CastError::DeviceNotFound)?;
        
        connection.sender.send(message).map_err(|_| CastError::SendError)?;
        Ok(())
    }

    /// Create a new cast session
    pub async fn create_session(
        &self,
        device_id: String,
        media_file_id: i64,
        user_identifier: String,
    ) -> Result<Uuid, CastError> {
        // Check if device exists
        {
            let devices = self.devices.read().await;
            if !devices.contains_key(&device_id) {
                return Err(CastError::DeviceNotFound);
            }
        }

        let session_id = Uuid::new_v4();
        let session = CastSession {
            session_id,
            device_id,
            media_file_id,
            user_identifier,
            state: PlaybackState::Stopped,
            position_ms: 0,
            volume: 100, // Default volume
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };

        let mut sessions = self.sessions.write().await;
        sessions.insert(session_id, session);

        tracing::info!("Created cast session: {}", session_id);
        Ok(session_id)
    }

    /// Update session state
    pub async fn update_session_state(
        &self,
        session_id: Uuid,
        state: PlaybackState,
        position_ms: Option<u64>,
        volume: Option<u8>,
    ) -> Result<(), CastError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(&session_id)
            .ok_or(CastError::SessionNotFound)?;

        session.state = state;
        if let Some(pos) = position_ms {
            session.position_ms = pos;
        }
        if let Some(vol) = volume {
            session.volume = vol;
        }
        session.updated_at = chrono::Utc::now();

        Ok(())
    }

    /// Get session
    pub async fn get_session(&self, session_id: Uuid) -> Option<CastSession> {
        let sessions = self.sessions.read().await;
        sessions.get(&session_id).cloned()
    }

    /// Stop and remove a session
    pub async fn stop_session(&self, session_id: Uuid) -> Result<(), CastError> {
        let mut sessions = self.sessions.write().await;
        sessions
            .remove(&session_id)
            .ok_or(CastError::SessionNotFound)?;

        tracing::info!("Stopped cast session: {}", session_id);
        Ok(())
    }

    /// Get all active sessions for a user
    pub async fn get_user_sessions(&self, user_identifier: &str) -> Vec<CastSession> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .filter(|s| s.user_identifier == user_identifier)
            .cloned()
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastDevice {
    pub device_id: String,
    pub name: String,
    pub device_type: DeviceType,
    pub capabilities: DeviceCapabilities,
    pub last_seen: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    MpvShim,
    Browser,
    Kodi,
    Plex,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCapabilities {
    /// Supports direct play (no transcoding needed)
    pub direct_play: bool,
    /// Supported video codecs (e.g., h264, hevc, av1)
    pub video_codecs: Vec<String>,
    /// Supported audio codecs (e.g., aac, opus, flac)
    pub audio_codecs: Vec<String>,
    /// Supported subtitle formats (e.g., srt, ass, vtt)
    pub subtitle_formats: Vec<String>,
    /// Maximum resolution
    pub max_resolution: Option<String>,
}

impl Default for DeviceCapabilities {
    fn default() -> Self {
        Self {
            direct_play: true,
            video_codecs: vec![
                "h264".to_string(),
                "hevc".to_string(),
                "h265".to_string(),
                "av1".to_string(),
                "vp9".to_string(),
                "mpeg4".to_string(),
            ],
            audio_codecs: vec![
                "aac".to_string(),
                "mp3".to_string(),
                "opus".to_string(),
                "vorbis".to_string(),
                "flac".to_string(),
                "ac3".to_string(),
                "eac3".to_string(),
                "dts".to_string(),
            ],
            subtitle_formats: vec![
                "srt".to_string(),
                "ass".to_string(),
                "ssa".to_string(),
                "vtt".to_string(),
            ],
            max_resolution: Some("4k".to_string()),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CastError {
    #[error("Device not found")]
    DeviceNotFound,
    #[error("Session not found")]
    SessionNotFound,
    #[error("Invalid state transition")]
    InvalidStateTransition,
    #[error("Playback error: {0}")]
    PlaybackError(String),
    #[error("Failed to send message to device")]
    SendError,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_device_registration() {
        let manager = CastManager::new();
        
        let device = CastDevice {
            device_id: "test-device-1".to_string(),
            name: "Test MPV Player".to_string(),
            device_type: DeviceType::MpvShim,
            capabilities: DeviceCapabilities::default(),
            last_seen: chrono::Utc::now(),
        };

        let (tx, _rx) = mpsc::unbounded_channel();
        manager.register_device(device.clone(), tx).await;
        let devices = manager.get_devices().await;
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_id, "test-device-1");
    }

    #[tokio::test]
    async fn test_session_creation() {
        let manager = CastManager::new();
        
        let device = CastDevice {
            device_id: "test-device-1".to_string(),
            name: "Test MPV Player".to_string(),
            device_type: DeviceType::MpvShim,
            capabilities: DeviceCapabilities::default(),
            last_seen: chrono::Utc::now(),
        };

        let (tx, _rx) = mpsc::unbounded_channel();
        manager.register_device(device, tx).await;
        
        let session_id = manager
            .create_session("test-device-1".to_string(), 123, 1)
            .await
            .unwrap();

        let session = manager.get_session(session_id).await;
        assert!(session.is_some());
        assert_eq!(session.unwrap().media_file_id, 123);
    }
}
