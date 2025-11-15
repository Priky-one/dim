use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Messages sent from server to cast device
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Acknowledge connection
    Connected {
        session_id: Option<Uuid>,
    },
    /// Start playback
    Play {
        session_id: Uuid,
        media_url: String,
        /// Direct file path for direct play
        file_path: Option<String>,
        media_info: MediaInfo,
        start_position_ms: u64,
        subtitle_url: Option<String>,
    },
    /// Pause playback
    Pause {
        session_id: Uuid,
    },
    /// Resume playback
    Resume {
        session_id: Uuid,
    },
    /// Stop playback
    Stop {
        session_id: Uuid,
    },
    /// Seek to position
    Seek {
        session_id: Uuid,
        position_ms: u64,
    },
    /// Set volume (0-100)
    SetVolume {
        session_id: Uuid,
        volume: u8,
    },
    /// Set subtitle track
    SetSubtitle {
        session_id: Uuid,
        subtitle_url: Option<String>,
    },
    /// Set audio track
    SetAudioTrack {
        session_id: Uuid,
        track_index: u32,
    },
    /// Ping to keep connection alive
    Ping,
}

/// Messages sent from cast device to server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Register device with server
    Register {
        device_id: String,
        device_name: String,
        device_type: String,
        capabilities: DeviceCapabilities,
    },
    /// Acknowledge command
    Ack {
        session_id: Uuid,
        command: String,
    },
    /// Report playback state
    StateUpdate {
        session_id: Uuid,
        state: PlaybackState,
        position_ms: u64,
        duration_ms: Option<u64>,
        #[serde(default)]
        volume: Option<u8>, // 0-100
    },
    /// Report error
    Error {
        session_id: Option<Uuid>,
        error: String,
    },
    /// Pong response
    Pong,
    /// Request available media info
    GetMediaInfo {
        media_file_id: i64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaInfo {
    pub id: i64,
    pub title: String,
    pub duration_ms: u64,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub resolution: Option<String>,
    /// Whether this can be direct played (no transcoding)
    pub direct_play: bool,
    /// Available audio tracks
    pub audio_tracks: Vec<AudioTrack>,
    /// Available subtitle tracks
    pub subtitle_tracks: Vec<SubtitleTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTrack {
    pub index: u32,
    pub language: Option<String>,
    pub codec: String,
    pub channels: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleTrack {
    pub index: u32,
    pub language: Option<String>,
    pub format: String,
    pub url: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackState {
    Stopped,
    Playing,
    Paused,
    Buffering,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCapabilities {
    pub direct_play: bool,
    pub video_codecs: Vec<String>,
    pub audio_codecs: Vec<String>,
    pub subtitle_formats: Vec<String>,
    pub max_resolution: Option<String>,
}
