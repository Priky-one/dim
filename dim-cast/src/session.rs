use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::protocol::PlaybackState;

/// Represents an active cast session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastSession {
    pub session_id: Uuid,
    pub device_id: String,
    pub media_file_id: i64,
    pub user_identifier: String,
    pub state: PlaybackState,
    pub position_ms: u64,
    #[serde(default = "default_volume")]
    pub volume: u8, // 0-100
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

fn default_volume() -> u8 {
    100
}

impl CastSession {
    pub fn can_transition_to(&self, new_state: PlaybackState) -> bool {
        use PlaybackState::*;
        
        match (&self.state, &new_state) {
            // Any state can go to stopped
            (_, Stopped) => true,
            // Can only play from stopped or paused
            (Stopped, Playing) | (Paused, Playing) | (Buffering, Playing) => true,
            // Can only pause from playing
            (Playing, Paused) => true,
            // Can buffer from any active state
            (Playing, Buffering) | (Paused, Buffering) => true,
            // Same state is allowed
            (a, b) if a == b => true,
            // Everything else is invalid
            _ => false,
        }
    }
}
