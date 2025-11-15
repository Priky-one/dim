import { useState, useCallback, useEffect } from "react";
import { useHistory, useLocation } from "react-router-dom";
import {
  useGetCastDevicesQuery,
  useStartCastSessionMutation,
  useControlCastSessionMutation,
} from "../../api/v1/cast";
import { getSelectedCastDevice } from "../Sidebar/CastButton";
import "./CastButton.scss";

interface CastButtonProps {
  mediaFileId: number;
  onCastStarted?: (sessionId: string) => void;
  autoStart?: boolean; // Auto-start casting when component mounts if device is selected
}

export default function CastButton({
  mediaFileId,
  onCastStarted,
  autoStart = false,
}: CastButtonProps) {

  const [showDevices, setShowDevices] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const history = useHistory();
  const location = useLocation();
  const isOnVideoPlayerPage = location.pathname.startsWith("/play/");

  const { data: devicesData, refetch } = useGetCastDevicesQuery();
  
  const [startCast] = useStartCastSessionMutation();
  const [controlCast] = useControlCastSessionMutation();

  const devices = devicesData?.devices || [];
  const hasCastDevices = devices.length > 0;
  const selectedDeviceId = getSelectedCastDevice();
  
  // Auto-start casting when video loads if device is selected
  useEffect(() => {
    if (autoStart && selectedDeviceId && !activeSessionId && mediaFileId) {
      handleDeviceSelect(selectedDeviceId);
    }
  }, [autoStart, selectedDeviceId, mediaFileId]); // Don't include activeSessionId to avoid loop

  const handleDeviceSelect = useCallback(async (deviceId: string) => {
    
    try {
      console.log("Calling startCast API...");
      const response = await startCast({
        device_id: deviceId,
        media_file_id: mediaFileId,
      }).unwrap();

      console.log("✅ Cast session started:", response.session_id);
      setActiveSessionId(response.session_id);
      setShowDevices(false);

      // Pause the browser video player when casting starts
      const videoElement = document.querySelector('video');
      if (videoElement) {
        videoElement.pause();
        console.log("⏸️  Paused browser video player");
      }

      // If we're on the video player page, navigate back to avoid confusing UX
      // The cast control bar will show at the bottom instead
      if (isOnVideoPlayerPage) {
        console.log("🔙 Navigating back from video player...");
        history.goBack();
      }

      if (onCastStarted) {
        onCastStarted(response.session_id);
      }
      
  // Removed alert for successful cast
    } catch (error) {
      console.error("❌ Failed to start cast:", error);
  // Removed alert for cast error
    }
  }, [mediaFileId, startCast, devices, onCastStarted, isOnVideoPlayerPage, history]);

    const handleCastClick = useCallback(() => {
    console.log("🔴 CAST BUTTON CLICKED!");
    console.log("🔴 showDevices before toggle:", showDevices);
    setShowDevices(!showDevices);
    console.log("🔴 showDevices after toggle:", !showDevices);
    refetch();
  }, [showDevices, refetch]);

  return (
    <div className="cast-button-wrapper">
      <button
        className={`cast-button ${activeSessionId ? "active" : ""} ${
          !hasCastDevices && !activeSessionId ? "disabled" : ""
        }`}
        onClick={handleCastClick}
        title={
          activeSessionId
            ? "Stop casting"
            : hasCastDevices
            ? "Cast to device"
            : "No cast devices available"
        }
      >
        <svg
          className="cast-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {activeSessionId ? (
            <>
              <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
              <line x1="2" y1="20" x2="2.01" y2="20" />
              <path
                d="M12 8 L16 12 L12 16"
                fill="currentColor"
                strokeWidth="0"
              />
            </>
          ) : (
            <>
              <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
              <line x1="2" y1="20" x2="2.01" y2="20" />
            </>
          )}
        </svg>
      </button>

      {showDevices && (
        <div className="cast-device-modal-overlay" onClick={() => setShowDevices(false)}>
          <div className="cast-device-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cast-device-modal-header">
              <h3>Cast to Device</h3>
              <button
                className="close-button"
                onClick={() => setShowDevices(false)}
              >
                ×
              </button>
            </div>
            <div className="cast-device-list">
              {devices.length === 0 ? (
                <div className="no-devices">
                  <p>No cast devices found</p>
                  <p className="hint">
                    Make sure your cast device (like jellyfin-mpv-shim) is
                    running and connected to Dim.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="device-list-hint">
                    🔴 LATEST BUILD v17.14 - Click a device to start casting:
                  </p>
                  {devices.map((device) => {
                    console.log("🔴 Rendering device:", device.name, device.device_id);
                    return (
                      <div
                        key={device.device_id}
                        className={`cast-device-item ${activeSessionId ? 'active' : ''}`}
                        onClick={() => {
                          console.log("🔴🔴🔴 DIV ONCLICK FIRED for:", device.name);
                          handleDeviceSelect(device.device_id);
                        }}
                      >
                        <div className="device-icon">
                          {device.device_type === "mpvshim" ? "🎬" : "📺"}
                        </div>
                        <div className="device-info">
                          <p className="device-name">{device.name}</p>
                          <p className="device-type">
                            {device.device_type}
                            {device.capabilities.direct_play && (
                              <span className="direct-play-badge">Direct Play</span>
                            )}
                          </p>
                          {activeSessionId && (
                            <p className="casting-indicator">▶️ Now Casting</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
