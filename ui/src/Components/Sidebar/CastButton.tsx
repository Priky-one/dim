import { useState, useEffect } from "react";
import { useGetCastDevicesQuery } from "../../api/v1/cast";
import "./CastButton.scss";

// Key for localStorage
const SELECTED_DEVICE_KEY = "dim_selected_cast_device";

// Export utility to get selected device
export const getSelectedCastDevice = (): string | null => {
  return localStorage.getItem(SELECTED_DEVICE_KEY);
};

// Export utility to clear selected device
export const clearSelectedCastDevice = (): void => {
  localStorage.removeItem(SELECTED_DEVICE_KEY);
};

export default function SidebarCastButton() {
  const [showDevices, setShowDevices] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const { data: devicesData, refetch } = useGetCastDevicesQuery();

  const devices = devicesData?.devices || [];
  const hasCastDevices = devices.length > 0;

  // Load selected device from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(SELECTED_DEVICE_KEY);
    if (saved) {
      setSelectedDeviceId(saved);
    }
  }, []);

  // Auto-select if only one device and none selected
  useEffect(() => {
    if (devices.length === 1 && !selectedDeviceId) {
      const deviceId = devices[0].device_id;
      setSelectedDeviceId(deviceId);
      localStorage.setItem(SELECTED_DEVICE_KEY, deviceId);
    }
  }, [devices, selectedDeviceId]);

  const handleCastClick = () => {
    refetch();
    setShowDevices(!showDevices);
  };

  const handleDeviceSelect = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    localStorage.setItem(SELECTED_DEVICE_KEY, deviceId);
    console.log("✅ Selected cast device:", deviceId);
  };

  return (
    <div className="sidebar-cast-button-wrapper">
      <button
        className={`sidebar-cast-button ${hasCastDevices ? "has-devices" : ""} ${selectedDeviceId ? "device-selected" : ""}`}
        onClick={handleCastClick}
        title={
          selectedDeviceId 
            ? `Casting to: ${devices.find(d => d.device_id === selectedDeviceId)?.name}` 
            : hasCastDevices 
            ? "Select cast device" 
            : "No cast devices"
        }
      >
        <svg
          className="cast-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
          <line x1="2" y1="20" x2="2.01" y2="20" />
          {selectedDeviceId && (
            <circle cx="18" cy="18" r="4" fill="currentColor" />
          )}
        </svg>
        {hasCastDevices && <span className="device-count">{devices.length}</span>}
      </button>

      {showDevices && (
        <div className="cast-device-modal-overlay" onClick={() => setShowDevices(false)}>
          <div className="cast-device-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cast-device-modal-header">
              <h3>Available Cast Devices</h3>
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
                  <p className="hint">
                    Run the Python MPV client: <code>python dim_mpv_shim.py</code>
                  </p>
                </div>
              ) : (
                <>
                  <p className="instruction">
                    Select a device to cast to when playing videos
                  </p>
                  {devices.map((device) => {
                    const isSelected = device.device_id === selectedDeviceId;
                    return (
                      <button
                        key={device.device_id}
                        className={`cast-device-item ${isSelected ? "selected" : ""}`}
                        onClick={() => handleDeviceSelect(device.device_id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="device-icon">
                          {isSelected ? "✅" : device.device_type === "mpvshim" ? "🎬" : "📺"}
                        </div>
                        <div className="device-info">
                          <div className="device-name">
                            {device.name}
                            {isSelected && <span className="selected-badge"> (Selected)</span>}
                          </div>
                          <div className="device-type">
                            {device.device_type}
                            {device.capabilities.direct_play && (
                              <span className="direct-play-badge">Direct Play</span>
                            )}
                          </div>
                          <div className="device-details">
                            Video: {device.capabilities.video_codecs.slice(0, 3).join(", ")}
                            {device.capabilities.video_codecs.length > 3 && "..."}
                          </div>
                        </div>
                        <div className="device-status">
                          <span className={`status-indicator ${isSelected ? "selected" : "online"}`}></span>
                          {isSelected ? "Selected" : "Available"}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
