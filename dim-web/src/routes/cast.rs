use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::{IntoResponse, Response};
use axum::Extension;
use axum::Json;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use dim_cast::{
    CastDevice, ClientMessage, DeviceType, MediaInfo, ServerMessage,
};
use dim_database::mediafile::MediaFile;
use dim_database::progress::Progress;
use dim_database::user::User;

use crate::error::DimErrorWrapper;
use crate::AppState;

/// WebSocket handler for cast devices
pub async fn cast_device_ws(
    ws: WebSocketUpgrade,
    State(AppState {
        cast_manager,
        conn,
        ..
    }): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| async move {
        let (mut ws_tx, mut ws_rx) = socket.split();

        // Create channel for server-to-client messages
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<dim_cast::ServerMessage>();

        // Send connection acknowledgment
        let msg = ServerMessage::Connected { session_id: None };
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = ws_tx
                .send(axum::extract::ws::Message::Text(json))
                .await;
        }

        let mut device_id: Option<String> = None;

        // Spawn task to forward messages from channel to WebSocket
        let forward_task = tokio::spawn(async move {
            let mut ws_tx = ws_tx;
            while let Some(server_msg) = rx.recv().await {
                if let Ok(json) = serde_json::to_string(&server_msg) {
                    tracing::debug!("Sending message to cast device: {}", json);
                    if ws_tx.send(axum::extract::ws::Message::Text(json)).await.is_err() {
                        tracing::error!("Failed to send message to WebSocket");
                        break;
                    }
                }
            }
        });

        while let Some(Ok(msg)) = ws_rx.next().await {
            if let axum::extract::ws::Message::Text(text) = msg {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Register {
                        device_id: did,
                        device_name,
                        device_type,
                        capabilities,
                    }) => {
                        // Register the device
                        let device = CastDevice {
                            device_id: did.clone(),
                            name: device_name,
                            device_type: match device_type.to_lowercase().as_str() {
                                "mpv" | "mpvshim" => DeviceType::MpvShim,
                                "browser" => DeviceType::Browser,
                                "kodi" => DeviceType::Kodi,
                                "plex" => DeviceType::Plex,
                                _ => DeviceType::Other,
                            },
                            capabilities: dim_cast::DeviceCapabilities {
                                direct_play: capabilities.direct_play,
                                video_codecs: capabilities.video_codecs,
                                audio_codecs: capabilities.audio_codecs,
                                subtitle_formats: capabilities.subtitle_formats,
                                max_resolution: capabilities.max_resolution,
                            },
                            last_seen: chrono::Utc::now(),
                        };

                        cast_manager.register_device(device, tx.clone()).await;
                        device_id = Some(did);
                        
                        tracing::info!("Cast device registered via WebSocket");
                    }
                    Ok(ClientMessage::StateUpdate {
                        session_id,
                        state,
                        position_ms,
                        duration_ms,
                        volume,
                    }) => {
                        tracing::info!(
                            "📊 Progress update: session={}, state={:?}, position={}ms, duration={:?}ms, volume={:?}",
                            session_id,
                            state,
                            position_ms,
                            duration_ms,
                            volume
                        );
                        
                        if let Err(e) = cast_manager
                            .update_session_state(session_id, state, Some(position_ms), volume)
                            .await
                        {
                            tracing::error!("Failed to update session state: {}", e);
                        }
                        
                        // Save progress to database for resume functionality
                        if let Some(session) = cast_manager.get_session(session_id).await {
                            let position_seconds = (position_ms / 1000) as i64;
                            
                            // Spawn a task to save progress to avoid blocking the WebSocket
                            let conn_clone = conn.clone();
                            tokio::spawn(async move {
                                async fn save_progress(
                                    conn: &crate::DbConnection,
                                    session: dim_cast::CastSession,
                                    position_seconds: i64,
                                ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
                                    tracing::debug!("Starting progress save for session {}", session.session_id);
                                    
                                    let mut lock = conn.writer().lock_owned().await;
                                    tracing::debug!("Acquired database lock");
                                    
                                    let mut tx = dim_database::write_tx(&mut lock).await?;
                                    tracing::debug!("Started write transaction");
                                    
                                    // Get mediafile to find media_id
                                    let mediafile = MediaFile::get_one(&mut tx, session.media_file_id).await
                                        .map_err(|e| {
                                            tracing::error!("Failed to get mediafile {}: {}", session.media_file_id, e);
                                            e
                                        })?;
                                    tracing::debug!("Got mediafile, media_id={:?}", mediafile.media_id);
                                    
                                    if let Some(media_id) = mediafile.media_id {
                                        // Get user to find user_id
                                        let user = User::get(&mut tx, &session.user_identifier).await
                                            .map_err(|e| {
                                                tracing::error!("Failed to get user {}: {}", session.user_identifier, e);
                                                e
                                            })?;
                                        tracing::debug!("Got user, user_id={:?}", user.id);
                                        
                                        // Save progress
                                        Progress::set(&mut tx, position_seconds, user.id, media_id).await
                                            .map_err(|e| {
                                                tracing::error!("Failed to set progress: {}", e);
                                                e
                                            })?;
                                        tracing::debug!("Set progress in database");
                                        
                                        tx.commit().await
                                            .map_err(|e| {
                                                tracing::error!("Failed to commit progress transaction: {}", e);
                                                e
                                            })?;
                                        
                                        tracing::info!(
                                            "💾 Saved progress: user={}, media={}, position={}s",
                                            session.user_identifier,
                                            media_id,
                                            position_seconds
                                        );
                                    } else {
                                        tracing::warn!("Mediafile {} has no media_id, skipping progress save", session.media_file_id);
                                    }
                                    
                                    Ok(())
                                }
                                
                                if let Err(e) = save_progress(&conn_clone, session, position_seconds).await {
                                    tracing::error!("❌ Failed to save progress: {}", e);
                                }
                            });
                        } else {
                            tracing::warn!("Session {} not found for progress save", session_id);
                        }
                    }
                    Ok(ClientMessage::GetMediaInfo { media_file_id }) => {
                        // Note: GetMediaInfo is not currently used in the cast protocol
                        // Media info is sent as part of the Play command
                        tracing::debug!("Received GetMediaInfo request for {}", media_file_id);
                    }
                    Ok(ClientMessage::Pong) => {
                        tracing::debug!("🏓 Pong received");
                    }
                    Ok(ClientMessage::Error { error, session_id }) => {
                        tracing::error!("❌ Cast device error (session={:?}): {}", session_id, error);
                    }
                    Ok(ClientMessage::Ack { session_id, command }) => {
                        tracing::info!("✅ Command acknowledged: {} (session={})", command, session_id);
                    }
                    Err(e) => {
                        tracing::error!("Failed to parse cast message: {}", e);
                    }
                }
            }
        }

        // Cleanup on disconnect
        if let Some(did) = device_id {
            cast_manager.unregister_device(&did).await;
        }

        // Cancel the forward task
        forward_task.abort();
    })
}

/// Get all available cast devices
pub async fn get_cast_devices(
    State(AppState { cast_manager, .. }): State<AppState>,
    Extension(_user): Extension<User>,
) -> Result<impl IntoResponse, DimErrorWrapper> {
    let devices = cast_manager.get_devices().await;
    Ok(Json(json!({ "devices": devices })))
}

#[derive(Deserialize)]
pub struct StartCastParams {
    device_id: String,
    media_file_id: i64,
}

/// Start a cast session
pub async fn start_cast_session(
    State(AppState {
        cast_manager,
        conn,
        ..
    }): State<AppState>,
    Extension(user): Extension<User>,
    Json(params): Json<StartCastParams>,
) -> Result<impl IntoResponse, DimErrorWrapper> {
    tracing::info!(
        "start_cast_session called: device_id={}, media_file_id={}, user={}",
        params.device_id,
        params.media_file_id,
        user.username
    );

    let session_id = cast_manager
        .create_session(params.device_id.clone(), params.media_file_id, user.username.clone())
        .await
        .map_err(|e| {
            tracing::error!("Failed to create cast session: {:?}", e);
            DimErrorWrapper::from(dim_core::errors::DimError::StreamingError(
                dim_core::errors::StreamingErrors::GidParseError,
            ))
        })?;

    tracing::info!("Created cast session: {}", session_id);

    // Get media file info
    let mut tx = conn.read().begin().await?;
    let media_file = MediaFile::get_one(&mut tx, params.media_file_id).await
        .map_err(|e| {
            tracing::error!("Failed to get media file {}: {:?}", params.media_file_id, e);
            e
        })?;

    tracing::info!("Got media file: {} ({})", media_file.id, media_file.target_file);

    // For direct play, we'll provide the file path
    // For transcoded, we'll use the streaming URL
    let direct_play = true; // TODO: Check device capabilities

    let media_url = if direct_play {
        format!("/api/v1/mediafile/{}/direct", params.media_file_id)
    } else {
        format!("/api/v1/stream/{}/manifest", params.media_file_id)
    };

    let media_info = MediaInfo {
        id: media_file.id,
        title: media_file.target_file.clone(),
        duration_ms: media_file.duration.unwrap_or(0) as u64 * 1000,
        video_codec: media_file.codec.clone(),
        audio_codec: media_file.audio.clone(),
        resolution: media_file.quality.map(|q| format!("{}p", q)),
        direct_play,
        audio_tracks: vec![],
        subtitle_tracks: vec![],
    };

    // Use logical media_id for progress (not media_file.id)
    let logical_media_id = media_file.media_id.unwrap_or(media_file.id);

    // Fetch last progress for user/logical_media_id
    let mut start_position_ms = 0u64;
    match dim_database::progress::Progress::get_for_media_user(&mut tx, user.id, logical_media_id).await {
        Ok(progress) => {
            tracing::info!(
                "Resume progress fetched: user_id={:?}, media_id={}, progress.delta={}s",
                user.id,
                logical_media_id,
                progress.delta
            );
            if progress.delta > 0 {
                start_position_ms = (progress.delta as u64) * 1000;
                tracing::info!(
                    "Setting start_position_ms to {} ({}s)",
                    start_position_ms,
                    progress.delta
                );
            } else {
                tracing::info!(
                    "Progress delta is zero, start_position_ms remains 0"
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                "No progress found for user_id={:?}, media_id={}: {}",
                user.id,
                logical_media_id,
                e
            );
        }
    }

    // Send play command to device via cast manager
    let play_cmd = ServerMessage::Play {
        session_id,
        media_url: media_url.clone(),
        file_path: Some(media_file.target_file.clone()),
        media_info: media_info.clone(),
        start_position_ms,
        subtitle_url: None,
    };

    tracing::info!(
        "▶️  Sending Play command: session={}, file={}, duration={}ms, resume_position={}ms",
        session_id,
        media_file.target_file,
        media_info.duration_ms,
        start_position_ms
    );

    if let Err(e) = cast_manager.send_to_device(&params.device_id, play_cmd).await {
        tracing::error!("Failed to send play command to device: {:?}", e);
    } else {
        tracing::info!("✅ Play command sent successfully to device");
    }

    Ok(Json(json!({
        "session_id": session_id,
        "media_url": media_url,
        "media_info": media_info,
        "file_path": media_file.target_file,
        "resume_position_ms": start_position_ms,
    })))
}

/// Control cast session
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum CastControlAction {
    Play,
    Pause,
    Resume,
    Stop,
    Seek { position_ms: u64 },
    #[serde(rename = "set_volume")]
    SetVolume { volume: u8 },
}

pub async fn control_cast_session(
    State(AppState { cast_manager, .. }): State<AppState>,
    Extension(_user): Extension<User>,
    Path(session_id): Path<Uuid>,
    Json(action): Json<CastControlAction>,
) -> Result<impl IntoResponse, DimErrorWrapper> {
    use dim_cast::PlaybackState;

    // Get the session to find the device
    let session = cast_manager.get_session(session_id).await.ok_or_else(|| {
        DimErrorWrapper::from(dim_core::errors::DimError::StreamingError(
            dim_core::errors::StreamingErrors::GidParseError,
        ))
    })?;

    // Send command to the device
    let server_msg = match action {
        CastControlAction::Play | CastControlAction::Resume => {
            tracing::info!("▶️  Sending Resume command to session {}", session_id);
            cast_manager
                .update_session_state(session_id, PlaybackState::Playing, None, None)
                .await
                .map_err(|_| {
                    DimErrorWrapper::from(dim_core::errors::DimError::StreamingError(
                        dim_core::errors::StreamingErrors::GidParseError,
                    ))
                })?;
            ServerMessage::Resume { session_id }
        }
        CastControlAction::Pause => {
            tracing::info!("⏸️  Sending Pause command to session {}", session_id);
            cast_manager
                .update_session_state(session_id, PlaybackState::Paused, None, None)
                .await
                .map_err(|_| {
                    DimErrorWrapper::from(dim_core::errors::DimError::StreamingError(
                        dim_core::errors::StreamingErrors::GidParseError,
                    ))
                })?;
            ServerMessage::Pause { session_id }
        }
        CastControlAction::Stop => {
            tracing::info!("⏹️  Sending Stop command to session {}", session_id);
            cast_manager.stop_session(session_id).await.map_err(|_| {
                DimErrorWrapper::from(dim_core::errors::DimError::StreamingError(
                    dim_core::errors::StreamingErrors::GidParseError,
                ))
            })?;
            ServerMessage::Stop { session_id }
        }
        CastControlAction::Seek { position_ms } => {
            tracing::info!("⏩ Sending Seek command to session {} (position={}ms)", session_id, position_ms);
            cast_manager
                .update_session_state(session_id, PlaybackState::Playing, Some(position_ms), None)
                .await
                .map_err(|_| {
                    DimErrorWrapper::from(dim_core::errors::DimError::StreamingError(
                        dim_core::errors::StreamingErrors::GidParseError,
                    ))
                })?;
            ServerMessage::Seek {
                session_id,
                position_ms,
            }
        }
        CastControlAction::SetVolume { volume } => {
            tracing::info!("🔊 Sending SetVolume command to session {} (volume={})", session_id, volume);
            ServerMessage::SetVolume {
                session_id,
                volume,
            }
        }
    };

    // Send the command to the device
    if let Err(e) = cast_manager.send_to_device(&session.device_id, server_msg).await {
        tracing::error!("❌ Failed to send control command to device: {:?}", e);
    } else {
        tracing::info!("✅ Control command sent successfully");
    }

    Ok(Json(json!({ "status": "ok" })))
}

/// Get active cast sessions for current user
pub async fn get_user_cast_sessions(
    State(AppState { cast_manager, .. }): State<AppState>,
    Extension(user): Extension<User>,
) -> Result<impl IntoResponse, DimErrorWrapper> {
    let sessions = cast_manager.get_user_sessions(&user.username).await;
    Ok(Json(json!({ "sessions": sessions })))
}

/// Get specific cast session
pub async fn get_cast_session(
    State(AppState { cast_manager, .. }): State<AppState>,
    Extension(_user): Extension<User>,
    Path(session_id): Path<Uuid>,
) -> Result<impl IntoResponse, DimErrorWrapper> {
    let session = cast_manager.get_session(session_id).await;
    Ok(Json(json!({ "session": session })))
}
