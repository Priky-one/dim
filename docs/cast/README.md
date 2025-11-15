# Dim Casting Setup Guide

This guide will help you set up casting to external players like MPV, enabling direct playback of all media codecs without browser limitations.

## Quick Start (5 minutes)

### 1. Install Python Dependencies

```bash
pip install python-mpv websockets
```

### 2. Get Your Dim Auth Token

1. Open Dim in your browser and log in
2. Press F12 to open Developer Tools
3. Go to "Application" (Chrome) or "Storage" (Firefox) → Cookies
4. Find the cookie named `__Secure-auth-token`
5. Copy its value (the auth token)

### 3. Run the MPV Shim

```bash
cd /path/to/dim
python docs/cast/dim_mpv_shim.py http://localhost:8000 YOUR_AUTH_TOKEN "Living Room TV"
```

Replace:
- `http://localhost:8000` with your Dim server URL
- `YOUR_AUTH_TOKEN` with the token from step 2
- `"Living Room TV"` with a name for your player

### 4. Start Casting!

1. Go to any media in Dim web UI
2. Click the cast button (📡) in the video player
3. Select your device from the list
4. Enjoy direct playback with all codecs!

## Features

✅ **Direct Play** - No transcoding, plays files directly from disk  
✅ **All Codecs** - H.264, HEVC/H.265, AV1, VP9, and more  
✅ **All Audio** - AAC, AC3, DTS, FLAC, TrueHD, etc.  
✅ **Subtitles** - SRT, ASS, SSA, VTT support  
✅ **4K/HDR** - Full quality, no browser limitations  
✅ **Remote Control** - Play/pause/seek from web UI  

## System Requirements

### MPV Shim Client
- Python 3.7+
- libmpv (usually installed with mpv)
- Network access to Dim server

### Dim Server
- Dim v0.4.0+ with casting support
- Files accessible on filesystem (for direct play)

## Advanced Setup

### Running as a Service (Linux)

Create `/etc/systemd/system/dim-mpv-shim.service`:

```ini
[Unit]
Description=Dim MPV Shim
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/dim
ExecStart=/usr/bin/python3 docs/cast/dim_mpv_shim.py http://localhost:8000 YOUR_TOKEN "My MPV"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable dim-mpv-shim
sudo systemctl start dim-mpv-shim
```

### Running on Different Computer

The MPV shim can run on a different computer than the Dim server:

```bash
# On your HTPC/media player computer
python dim_mpv_shim.py http://192.168.1.100:8000 YOUR_TOKEN "HTPC Player"
```

Make sure:
- The computer can access Dim server over network
- The computer has access to media files (via NFS, SMB, or same file paths)

### Using with Network Shares

If your media is on network shares, ensure the MPV shim computer has them mounted:

```bash
# Example: Mount NFS share
sudo mount -t nfs server:/media /mnt/media

# Then run shim
python dim_mpv_shim.py http://localhost:8000 YOUR_TOKEN "My Player"
```

The file paths in Dim must match the mounted paths on the client.

## Adapting jellyfin-mpv-shim

If you want to modify the existing jellyfin-mpv-shim to work with Dim:

See [JELLYFIN_MPV_SHIM_ADAPTATION.md](./JELLYFIN_MPV_SHIM_ADAPTATION.md) for detailed instructions.

## Troubleshooting

### Cast button doesn't appear
- Make sure the MPV shim is running
- Check that it's connected (look for "Device registered" in logs)
- Refresh the Dim web page

### "No devices available"
- Verify the shim is running: `ps aux | grep dim_mpv_shim`
- Check shim logs for connection errors
- Ensure WebSocket URL is correct

### Playback doesn't start
- **Direct Play**: Check file permissions and paths
- **Streaming**: Verify auth token is valid
- Check shim logs for errors
- Ensure codec is supported by MPV

### Video plays but no audio
- Check MPV audio output settings
- Verify audio codec is supported
- Try: `mpv --audio-device=help` to see available devices

### Subtitles don't show
- Ensure subtitle format is supported (SRT, ASS, VTT)
- Check subtitle file permissions
- Try enabling subtitles manually in MPV (press 'v')

### Connection keeps dropping
- Check network stability
- Look for firewall issues
- Ensure Dim server is accessible

## Protocol Documentation

For detailed protocol documentation and implementing your own client:

See [CASTING.md](../CASTING.md)

## Tips

### Keyboard Shortcuts in MPV
- **Space**: Play/Pause
- **←/→**: Seek backward/forward 5 seconds
- **↑/↓**: Seek forward/backward 60 seconds
- **v**: Toggle subtitles
- **j**: Cycle through subtitle tracks
- **#**: Cycle through audio tracks
- **f**: Toggle fullscreen
- **q**: Quit

### Multiple Devices
You can run multiple MPV shims with different device names:

```bash
# Living room
python dim_mpv_shim.py http://server:8000 TOKEN "Living Room"

# Bedroom
python dim_mpv_shim.py http://server:8000 TOKEN "Bedroom"
```

### Performance Tips
- Use direct play when possible (faster, better quality)
- For 4K HDR: ensure hardware has HEVC/VP9 decoding
- Use wired connection for best streaming performance
- Enable hardware acceleration in MPV config

## Support

For issues or questions:
- Check Dim GitHub issues
- Review server logs: `docker logs dim` or check Dim data directory
- Review shim logs: run with `python -u dim_mpv_shim.py ...` for unbuffered output

## Contributing

Contributions welcome! Areas to improve:
- Additional player support (Kodi, Plex clients)
- UI enhancements
- Protocol extensions
- Documentation improvements

See the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.
